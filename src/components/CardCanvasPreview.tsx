import React, { useEffect, useRef, useState } from 'react';
import { User, Wifi } from 'lucide-react';
import {
  getCardTrimMm,
  getCurvedTextArcGeometry,
  getElementBoxMetrics,
  getFontWidthRatio,
  getStarburstPolygonPoints,
  getStudioBaseWidthPx,
  isSameTarget,
  mmToTrimWidthPct,
  resolveSideMediaClipCircle,
  type SelectableCardTarget,
} from '../lib/cardLayout';
import { resolveCardTokens } from '../lib/printPdf';
import type { CardSideDesign, MediaClipCircleSpec, PersonalInformation } from '../types';

export type CardCanvasTarget = SelectableCardTarget;

interface CardCanvasPreviewProps {
  side: CardSideDesign;
  orientation: 'landscape' | 'vertical';
  personalInfo: Partial<PersonalInformation>;
  /**
   * CRITICAL BUSINESS RULE:
   * Before purchase: actualQrPng must remain undefined!
   * Only post-payment Printer/Admin views pass the real QR artwork.
   */
  actualQrPng?: string;
  showPrintGuides?: boolean;
  interactive?: boolean;
  selectedTarget?: CardCanvasTarget | null;
  selectedTargets?: CardCanvasTarget[];
  onSelectTarget?: (target: CardCanvasTarget | null, additive?: boolean) => void;
  onMoveItem?: (target: CardCanvasTarget, xPct: number, yPct: number) => void;
  onDragEnd?: () => void;
  guidelines?: { vertical?: number[]; horizontal?: number[] };
  editingTextId?: string | null;
  onStartEditText?: (id: string | null) => void;
  onUpdateTextValue?: (id: string, nextText: string) => void;
  /**
   * When true, double-clicking a {{TOKEN}} text element pre-fills the inline editor
   * with its resolved profile text so users can edit default text directly.
   */
  editResolvedText?: boolean;
  // Backward-compatible text selection callbacks
  onSelectElement?: (id: string) => void;
  selectedElementId?: string | null;
}

export const CardCanvasPreview: React.FC<CardCanvasPreviewProps> = ({
  side,
  orientation,
  personalInfo,
  actualQrPng,
  showPrintGuides = false,
  interactive = false,
  selectedTarget,
  selectedTargets,
  onSelectTarget,
  onMoveItem,
  onDragEnd,
  guidelines,
  editingTextId,
  onStartEditText,
  onUpdateTextValue,
  editResolvedText = false,
  onSelectElement,
  selectedElementId,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<{
    target: CardCanvasTarget;
    startX: number;
    startY: number;
    origXPct: number;
    origYPct: number;
    moved: boolean;
  } | null>(null);
  const [localEditingId, setLocalEditingId] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState('');
  const inlineInitialShownRef = useRef('');
  const inlineOrigRawRef = useRef('');

  const activeEditingId = editingTextId !== undefined ? editingTextId : localEditingId;

  const setActiveEditing = (id: string | null) => {
    if (onStartEditText) onStartEditText(id);
    else setLocalEditingId(id);
  };

  useEffect(() => {
    if (!activeEditingId) return;
    const found = side.elements.find((e) => e.id === activeEditingId);
    if (found) {
      inlineOrigRawRef.current = found.text;
      const shown = editResolvedText ? resolveCardTokens(found.text, personalInfo) : found.text;
      inlineInitialShownRef.current = shown;
      setInlineDraft(shown);
    }
  }, [activeEditingId]);

  const isVertical = orientation === 'vertical';
  const aspectRatio = isVertical ? '54 / 85.6' : '85.6 / 54';

  const bgStyle: React.CSSProperties = side.gradientTo
    ? { background: `linear-gradient(135deg, ${side.backgroundColor}, ${side.gradientTo})` }
    : { backgroundColor: side.backgroundColor || '#0B1D3A' };

  useEffect(() => {
    if (!dragging || !onMoveItem) return;

    const handleMove = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY);
      if (!dragging.moved && dist < 4) return;
      const box = containerRef.current?.getBoundingClientRect();
      if (!box || box.width <= 0 || box.height <= 0) return;
      const dxPct = ((e.clientX - dragging.startX) / box.width) * 100;
      const dyPct = ((e.clientY - dragging.startY) / box.height) * 100;
      const hasClip = Boolean(resolveSideMediaClipCircle(side));
      const isMediaTarget = dragging.target.kind === 'avatar' || dragging.target.kind === 'logo';
      const minBound = dragging.target.kind === 'shape' ? -25 : hasClip && isMediaTarget ? -35 : 2;
      const maxBound = dragging.target.kind === 'shape' ? 95 : hasClip && isMediaTarget ? 95 : 88;
      const nextX = Number(Math.max(minBound, Math.min(maxBound, dragging.origXPct + dxPct)).toFixed(2));
      const nextY = Number(Math.max(minBound, Math.min(maxBound, dragging.origYPct + dyPct)).toFixed(2));
      if (!dragging.moved) {
        setDragging((prev) => (prev ? { ...prev, moved: true } : null));
      }
      onMoveItem(dragging.target, nextX, nextY);
    };

    const handleUp = () => {
      setDragging(null);
      onDragEnd?.();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [dragging, onMoveItem, onDragEnd]);

  const startDrag = (
    e: React.PointerEvent,
    target: CardCanvasTarget,
    origXPct: number,
    origYPct: number
  ) => {
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (target.kind === 'text' && !additive) {
      onSelectElement?.(target.id);
    }
    onSelectTarget?.(target, additive);
    if (!interactive || !onMoveItem) return;
    if (additive) return;
    if (target.kind === 'text' && activeEditingId === target.id) return;
    setDragging({
      target,
      startX: e.clientX,
      startY: e.clientY,
      origXPct,
      origYPct,
      moved: false,
    });
  };

  const commitInlineEdit = () => {
    if (!activeEditingId) return;
    const trimmed = inlineDraft.trim();
    if (trimmed && inlineDraft !== inlineInitialShownRef.current && onUpdateTextValue) {
      onUpdateTextValue(activeEditingId, trimmed);
    }
    setActiveEditing(null);
  };

  const isTargetSelected = (t: CardCanvasTarget) => {
    if (selectedTargets && selectedTargets.length > 0) {
      return selectedTargets.some((s) => isSameTarget(s, t));
    }
    if (selectedTarget) {
      return isSameTarget(selectedTarget, t);
    }
    return t.kind === 'text' && selectedElementId === t.id;
  };

  const studioBasePx = getStudioBaseWidthPx(orientation);

  return (
    <div className="w-full flex flex-col items-center">
      <div
        ref={containerRef}
        onClick={() => {
          if (activeEditingId) commitInlineEdit();
          onSelectTarget?.(null);
        }}
        className={`relative w-full overflow-hidden rounded-xl shadow-md border border-slate-300 select-none ${
          isVertical ? 'max-w-[270px]' : 'max-w-[440px]'
        }`}
        style={{ aspectRatio, containerType: 'inline-size', ...bgStyle }}
      >
        {/* Fixed Fit-to-Size Background Image */}
        {side.backgroundImageUrl && (
          <img
            src={side.backgroundImageUrl}
            alt="Card background"
            referrerPolicy="no-referrer"
            draggable={false}
            className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* Optional Card Outer Border */}
        {side.showBorder && (
          <div
            className="pointer-events-none absolute inset-0 rounded-xl z-20"
            style={{
              border: `${Math.max(1, side.borderWidthPx ?? 2)}px solid ${side.borderColor || '#D4AF37'}`,
            }}
          />
        )}

        {/* Print Bleed & Safe Area Proof Guides */}
        {showPrintGuides && (
          <>
            <div
              className="pointer-events-none absolute inset-[3.3%] border border-dashed border-cyan-400/90 rounded-sm"
              title="Trim Line (85.6 x 54 mm)"
            />
            <div
              className="pointer-events-none absolute inset-[7.5%] border border-dashed border-emerald-400/90 rounded-sm"
              title="Safe Margin (4 mm)"
            />
          </>
        )}

        {/* Live Magnetic Alignment Guidelines */}
        {(guidelines?.vertical || []).map((xPct, idx) => (
          <div
            key={`gv-${idx}`}
            style={{ left: `${xPct}%` }}
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-cyan-400 shadow-[0_0_4px_rgba(34,211,238,0.8)] z-40"
          />
        ))}
        {(guidelines?.horizontal || []).map((yPct, idx) => (
          <div
            key={`gh-${idx}`}
            style={{ top: `${yPct}%` }}
            className="pointer-events-none absolute left-0 right-0 h-px bg-cyan-400 shadow-[0_0_4px_rgba(34,211,238,0.8)] z-40"
          />
        ))}

        {/* Editable Shape / Accent / Divider Layers */}
        {(side.shapes || []).map((shp) => {
          const isSelected = isTargetSelected({ kind: 'shape', id: shp.id });

          if (shp.kind === 'star') {
            const pts = getStarburstPolygonPoints(7)
              .map(([x, y]) => `${x},${y}`)
              .join(' ');
            return (
              <button
                key={shp.id}
                type="button"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => startDrag(e, { kind: 'shape', id: shp.id }, shp.xPct, shp.yPct)}
                style={{
                  left: `${shp.xPct}%`,
                  top: `${shp.yPct}%`,
                  width: `${shp.widthPct}%`,
                  height: `${Math.max(1.5, shp.heightPct)}%`,
                  opacity: shp.opacity ?? 1,
                  transform: shp.rotationDeg ? `rotate(${shp.rotationDeg}deg)` : undefined,
                }}
                className={`absolute bg-transparent p-0 transition-shadow ${
                  interactive ? 'cursor-move touch-none hover:ring-1 hover:ring-cyan-400 rounded' : 'pointer-events-none'
                } ${isSelected ? 'ring-2 ring-cyan-400 rounded' : ''}`}
                title={interactive ? 'Click to select · Drag to move Starburst' : undefined}
              >
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full pointer-events-none overflow-visible">
                  <polygon
                    points={pts}
                    fill={shp.color === 'transparent' ? 'none' : shp.color}
                    stroke={shp.borderWidthPx ? shp.borderColor || '#FFFFFF' : 'none'}
                    strokeWidth={shp.borderWidthPx ? Math.max(1.5, shp.borderWidthPx * 1.6) : 0}
                    strokeLinejoin="miter"
                  />
                </svg>
              </button>
            );
          }

          const shapeBg: React.CSSProperties =
            shp.color === 'transparent'
              ? { backgroundColor: 'transparent' }
              : shp.gradientTo
              ? { background: `linear-gradient(135deg, ${shp.color}, ${shp.gradientTo})` }
              : { backgroundColor: shp.color };
          const radius =
            shp.kind === 'circle' || shp.kind === 'pill'
              ? '9999px'
              : shp.borderRadiusPx !== undefined
              ? `${shp.borderRadiusPx}px`
              : '0px';

          return (
            <button
              key={shp.id}
              type="button"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => startDrag(e, { kind: 'shape', id: shp.id }, shp.xPct, shp.yPct)}
              style={{
                left: `${shp.xPct}%`,
                top: `${shp.yPct}%`,
                width: `${shp.widthPct}%`,
                height: `${Math.max(0.8, shp.heightPct)}%`,
                borderRadius: radius,
                opacity: shp.opacity ?? 1,
                border: shp.borderWidthPx ? `${shp.borderWidthPx}px solid ${shp.borderColor || '#FFFFFF'}` : undefined,
                transform: shp.rotationDeg ? `rotate(${shp.rotationDeg}deg)` : undefined,
                ...shapeBg,
              }}
              className={`absolute transition-shadow ${
                interactive ? 'cursor-move touch-none hover:ring-1 hover:ring-cyan-400' : 'pointer-events-none'
              } ${isSelected ? 'ring-2 ring-cyan-400' : ''}`}
              title={interactive ? 'Click to select (Shift+Click for multi-select) · Drag to move' : undefined}
            />
          );
        })}

        {/* Logo & Profile Photo / Avatar (Optionally clipped inside circular medallion behind border/ring) */}
        {(() => {
          const activeClip = resolveSideMediaClipCircle(side);

          const renderLogoLayer = (clip?: MediaClipCircleSpec) => {
            if (!side.logoDataUrl) return null;
            const logoWidthTrimPct = mmToTrimWidthPct(side.logoWidthMm || 14, orientation);
            const leftPct = clip ? ((side.logoX - clip.xPct) / clip.widthPct) * 100 : side.logoX;
            const topPct = clip ? ((side.logoY - clip.yPct) / clip.heightPct) * 100 : side.logoY;
            const widthPct = clip ? (logoWidthTrimPct / clip.widthPct) * 100 : logoWidthTrimPct;
            return (
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => startDrag(e, { kind: 'logo' }, side.logoX, side.logoY)}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                }}
                className={`absolute bg-transparent p-0 rounded transition-shadow ${
                  interactive
                    ? 'pointer-events-auto cursor-move touch-none hover:ring-1 hover:ring-cyan-400'
                    : 'cursor-default pointer-events-none'
                } ${isTargetSelected({ kind: 'logo' }) && !clip ? 'ring-2 ring-cyan-400' : ''}`}
                title={interactive ? 'Drag to move Logo' : undefined}
              >
                <img
                  src={side.logoDataUrl}
                  alt="Company logo"
                  draggable={false}
                  className="w-full h-auto object-contain pointer-events-none"
                />
              </button>
            );
          };

          const renderAvatarLayer = (clip?: MediaClipCircleSpec) => {
            if (!side.showAvatar) return null;
            const resolvedPhoto = side.avatarDataUrl || personalInfo.photoDataUrl;
            const shapeClass =
              side.avatarShape === 'circle'
                ? 'rounded-full'
                : side.avatarShape === 'rounded'
                ? 'rounded-2xl'
                : 'rounded-none';
            const avatarWidthTrimPct = mmToTrimWidthPct(side.avatarSizeMm || 13, orientation);
            const leftPct = clip ? ((side.avatarX - clip.xPct) / clip.widthPct) * 100 : side.avatarX;
            const topPct = clip ? ((side.avatarY - clip.yPct) / clip.heightPct) * 100 : side.avatarY;
            const widthPct = clip ? (avatarWidthTrimPct / clip.widthPct) * 100 : avatarWidthTrimPct;
            return (
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => startDrag(e, { kind: 'avatar' }, side.avatarX, side.avatarY)}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  aspectRatio: '1 / 1',
                  border:
                    !clip && side.showAvatarBorder
                      ? `2px solid ${side.avatarBorderColor || '#FFFFFF'}`
                      : 'none',
                }}
                className={`absolute ${shapeClass} overflow-hidden flex items-center justify-center ${
                  resolvedPhoto ? 'bg-transparent' : 'bg-slate-200'
                } ${
                  interactive
                    ? 'pointer-events-auto cursor-move touch-none hover:ring-2 hover:ring-cyan-400'
                    : 'cursor-default pointer-events-none'
                } ${isTargetSelected({ kind: 'avatar' }) && !clip ? 'ring-2 ring-cyan-400' : ''}`}
                title={interactive ? 'Drag to move Photo · Click to upload/crop/resize' : undefined}
              >
                {resolvedPhoto ? (
                  <img
                    src={resolvedPhoto}
                    alt="Profile avatar"
                    draggable={false}
                    className="w-full h-full object-cover pointer-events-none"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-slate-200 to-slate-300 text-slate-500 flex flex-col items-center justify-center gap-0.5 pointer-events-none">
                    <User className="w-1/2 h-1/2 opacity-70" />
                    <span
                      className="font-semibold uppercase tracking-wider leading-none opacity-80"
                      style={{ fontSize: `${(7.5 / studioBasePx) * 100}cqw` }}
                    >
                      Photo
                    </span>
                  </div>
                )}
              </button>
            );
          };

          if (activeClip) {
            const mediaSelected = isTargetSelected({ kind: 'avatar' }) || isTargetSelected({ kind: 'logo' });
            return (
              <>
                <div
                  className="pointer-events-none absolute overflow-hidden rounded-full"
                  style={{
                    left: `${activeClip.xPct}%`,
                    top: `${activeClip.yPct}%`,
                    width: `${activeClip.widthPct}%`,
                    height: `${activeClip.heightPct}%`,
                  }}
                >
                  {renderLogoLayer(activeClip)}
                  {renderAvatarLayer(activeClip)}
                </div>
                {(activeClip.borderWidthPx || (interactive && mediaSelected)) && (
                  <div
                    className={`pointer-events-none absolute rounded-full ${
                      interactive && mediaSelected ? 'ring-2 ring-cyan-400' : ''
                    }`}
                    style={{
                      left: `${activeClip.xPct}%`,
                      top: `${activeClip.yPct}%`,
                      width: `${activeClip.widthPct}%`,
                      height: `${activeClip.heightPct}%`,
                      border: activeClip.borderWidthPx
                        ? `${activeClip.borderWidthPx}px solid ${activeClip.borderColor || '#FFFFFF'}`
                        : undefined,
                    }}
                  />
                )}
              </>
            );
          }

          return (
            <>
              {renderLogoLayer()}
              {renderAvatarLayer()}
            </>
          );
        })()}

        {/* SMART Contactless Symbol (Freely Draggable & Resizable in Studio) */}
        {side.showNfcIcon && (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) =>
              startDrag(e, { kind: 'nfc' }, side.nfcX ?? 88, side.nfcY ?? 10)
            }
            style={{
              left: `${side.nfcX ?? 88}%`,
              top: `${side.nfcY ?? 10}%`,
              color: side.nfcIconColor || '#38BDF8',
            }}
            className={`absolute p-0.5 rounded rotate-90 transition-shadow ${
              interactive
                ? 'cursor-move touch-none hover:ring-1 hover:ring-cyan-400'
                : 'pointer-events-none'
            } ${isTargetSelected({ kind: 'nfc' }) ? 'ring-2 ring-cyan-400 bg-slate-900/20' : ''}`}
            aria-label="SMART enabled card"
            title={interactive ? 'Drag to move SMART icon' : undefined}
          >
            <Wifi
              className="pointer-events-none"
              style={{
                width: `${(((side.nfcSizeMm || 6) * 3.2) / studioBasePx) * 100}cqw`,
                height: `${(((side.nfcSizeMm || 6) * 3.2) / studioBasePx) * 100}cqw`,
              }}
            />
          </button>
        )}

        {/* Editable Text Elements (1:1 Box Wrapping + Alignment + Multi-Select + Curved Arcs + Inline Edit) */}
        {side.elements.map((el) => {
          const isSelected = isTargetSelected({ kind: 'text', id: el.id });
          const isEditing = interactive && activeEditingId === el.id && Boolean(onUpdateTextValue);
          const fontRatio = getFontWidthRatio(el.fontSizePt, orientation);
          const fontCqw = (fontRatio * 100).toFixed(3);
          const box = getElementBoxMetrics(el);

          if (isEditing) {
            return (
              <input
                key={el.id}
                type="text"
                autoFocus
                value={inlineDraft}
                onChange={(e) => {
                  const val = e.target.value;
                  setInlineDraft(val);
                  if (val !== inlineInitialShownRef.current && val.trim().length > 0) {
                    onUpdateTextValue?.(el.id, val);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={commitInlineEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitInlineEdit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    if (inlineOrigRawRef.current) {
                      onUpdateTextValue?.(el.id, inlineOrigRawRef.current);
                    }
                    setActiveEditing(null);
                  }
                }}
                style={{
                  left: `${box.leftPct}%`,
                  top: `${box.topPct}%`,
                  width: `${box.widthPct}%`,
                  color: el.color,
                  fontFamily: el.fontFamily,
                  fontWeight: el.fontWeight === 'bold' ? 700 : 400,
                  fontStyle: el.fontStyle === 'italic' ? 'italic' : 'normal',
                  textDecoration: el.textDecoration === 'underline' ? 'underline' : 'none',
                  textTransform: el.uppercase ? 'uppercase' : 'none',
                  letterSpacing: el.letterSpacingPx ? `${(el.letterSpacingPx / studioBasePx) * 100}cqw` : undefined,
                  fontSize: `${fontCqw}cqw`,
                  textAlign: el.align,
                }}
                className="absolute z-30 px-1 py-0.5 rounded border-2 border-cyan-400 bg-slate-950/80 outline-none shadow-md leading-[1.25]"
              />
            );
          }

          const rawResolved = resolveCardTokens(el.text, personalInfo);
          const displayText = el.uppercase ? rawResolved.toUpperCase() : rawResolved;
          const isCurved = Math.abs(el.curveDeg || 0) >= 3;

          if (isCurved) {
            const trim = getCardTrimMm(orientation);
            const fontSizeMm = fontRatio * trim.width;
            const letterSpacingMm = el.letterSpacingPx ? (el.letterSpacingPx / studioBasePx) * trim.width : 0;
            const arc = getCurvedTextArcGeometry({
              xPct: box.leftPct,
              yPct: box.topPct,
              maxWidthPct: box.widthPct,
              fontSizeMm,
              curveDeg: el.curveDeg || 0,
              cardW: trim.width,
              cardH: trim.height,
            });
            const pathId = `arc_${el.id}_${orientation}`;
            const hitHeightPct = Math.max(12, Math.min(34, ((fontSizeMm * 2.2) / trim.height) * 100));

            return (
              <React.Fragment key={el.id}>
                <svg
                  viewBox={`0 0 ${trim.width} ${trim.height}`}
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 w-full h-full overflow-visible"
                >
                  <defs>
                    <path
                      id={pathId}
                      d={`M ${arc.startX.toFixed(3)},${arc.startY.toFixed(3)} A ${arc.radius.toFixed(3)},${arc.radius.toFixed(3)} 0 0,${arc.sweepFlag} ${arc.endX.toFixed(3)},${arc.endY.toFixed(3)}`}
                    />
                  </defs>
                  <text
                    fill={el.color || '#FFFFFF'}
                    fontFamily={el.fontFamily}
                    fontWeight={el.fontWeight === 'bold' ? 700 : 400}
                    fontStyle={el.fontStyle === 'italic' ? 'italic' : 'normal'}
                    fontSize={fontSizeMm}
                    letterSpacing={letterSpacingMm}
                    textAnchor="middle"
                  >
                    <textPath href={`#${pathId}`} startOffset="50%">
                      {displayText || (interactive ? 'Empty text' : '')}
                    </textPath>
                  </text>
                </svg>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => startDrag(e, { kind: 'text', id: el.id }, el.xPct, el.yPct)}
                  onDoubleClick={(e) => {
                    if (!interactive || !onUpdateTextValue) return;
                    e.stopPropagation();
                    setDragging(null);
                    inlineOrigRawRef.current = el.text;
                    const shown = editResolvedText ? rawResolved : el.text;
                    inlineInitialShownRef.current = shown;
                    setInlineDraft(shown);
                    setActiveEditing(el.id);
                  }}
                  style={{
                    left: `${box.leftPct}%`,
                    top: `${box.topPct}%`,
                    width: `${box.widthPct}%`,
                    height: `${hitHeightPct}%`,
                  }}
                  className={`absolute bg-transparent transition-shadow ${
                    interactive || onSelectElement || onSelectTarget
                      ? 'cursor-move touch-none hover:ring-1 hover:ring-cyan-400 rounded'
                      : 'pointer-events-none'
                  } ${isSelected ? 'ring-2 ring-cyan-400 rounded' : ''}`}
                  aria-label={displayText || 'Curved text'}
                  title={interactive ? 'Click to select · Drag to move · Double-click to edit curved text' : undefined}
                />
              </React.Fragment>
            );
          }

          return (
            <button
              key={el.id}
              type="button"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => startDrag(e, { kind: 'text', id: el.id }, el.xPct, el.yPct)}
              onDoubleClick={(e) => {
                if (!interactive || !onUpdateTextValue) return;
                e.stopPropagation();
                setDragging(null);
                inlineOrigRawRef.current = el.text;
                const shown = editResolvedText ? rawResolved : el.text;
                inlineInitialShownRef.current = shown;
                setInlineDraft(shown);
                setActiveEditing(el.id);
              }}
              style={{
                left: `${box.leftPct}%`,
                top: `${box.topPct}%`,
                width: `${box.widthPct}%`,
                color: el.color,
                fontFamily: el.fontFamily,
                fontWeight: el.fontWeight === 'bold' ? 700 : 400,
                fontStyle: el.fontStyle === 'italic' ? 'italic' : 'normal',
                textDecoration: el.textDecoration === 'underline' ? 'underline' : 'none',
                letterSpacing: el.letterSpacingPx ? `${(el.letterSpacingPx / studioBasePx) * 100}cqw` : undefined,
                fontSize: `${fontCqw}cqw`,
                textAlign: el.align,
                whiteSpace: 'normal',
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
              }}
              className={`absolute leading-[1.25] transition-shadow ${
                interactive || onSelectElement || onSelectTarget
                  ? 'cursor-move touch-none hover:ring-1 hover:ring-cyan-400 rounded'
                  : 'cursor-default'
              } ${isSelected ? 'ring-2 ring-cyan-400 bg-slate-900/15 rounded' : ''}`}
              title={interactive ? 'Click to select (Shift+Click multi-select) · Drag to move · Double-click to edit' : undefined}
            >
              {displayText || (interactive ? <span className="opacity-50 italic">Empty text</span> : '')}
            </button>
          );
        })}

        {/* QR Code Area: Non-Scannable Placeholder Pre-Purchase, Freely Movable in Studio */}
        {side.showQrSlot && (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => startDrag(e, { kind: 'qr' }, side.qrSlotX, side.qrSlotY)}
            style={{
              left: `${side.qrSlotX}%`,
              top: `${side.qrSlotY}%`,
              width: `${mmToTrimWidthPct(side.qrSizeMm || 17, orientation)}%`,
              aspectRatio: '1 / 1',
            }}
            className={`absolute bg-white rounded-md p-1 flex items-center justify-center shadow-xs border border-slate-200 ${
              interactive ? 'cursor-move touch-none hover:ring-2 hover:ring-cyan-400' : 'cursor-default'
            } ${isTargetSelected({ kind: 'qr' }) ? 'ring-2 ring-cyan-400' : ''}`}
            title={interactive ? 'Drag to adjust QR Code position' : undefined}
          >
            {actualQrPng ? (
              <img
                src={actualQrPng}
                alt="Verified QR code"
                draggable={false}
                className="w-full h-full object-contain pointer-events-none"
              />
            ) : (
              <div className="w-full h-full border-2 border-dashed border-[#0B1D3A]/40 rounded flex flex-col items-center justify-center bg-slate-50 text-[#0B1D3A] p-1 pointer-events-none">
                <div
                  className="grid grid-cols-3 gap-0.5 opacity-40 mb-0.5"
                  style={{
                    width: `${(20 / studioBasePx) * 100}cqw`,
                    height: `${(20 / studioBasePx) * 100}cqw`,
                  }}
                >
                  <span className="bg-[#0B1D3A] rounded-[1px]" />
                  <span className="bg-transparent border border-[#0B1D3A]" />
                  <span className="bg-[#0B1D3A] rounded-[1px]" />
                  <span className="bg-transparent border border-[#0B1D3A]" />
                  <span className="bg-[#0B1D3A] rounded-[1px]" />
                  <span className="bg-transparent border border-[#0B1D3A]" />
                  <span className="bg-[#0B1D3A] rounded-[1px]" />
                  <span className="bg-[#0B1D3A] rounded-[1px]" />
                  <span className="bg-transparent border border-[#0B1D3A]" />
                </div>
                <span
                  className="font-mono font-bold tracking-wider uppercase leading-none"
                  style={{ fontSize: `${(8 / studioBasePx) * 100}cqw` }}
                >
                  QR CODE
                </span>
              </div>
            )}
          </button>
        )}
      </div>

      {showPrintGuides && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[11px] font-mono text-slate-500">
          <span>Trim: {isVertical ? '54.0 × 85.6 mm' : '85.6 × 54.0 mm'}</span>
          <span>·</span>
          <span className="text-cyan-700">Bleed: 3.0 mm</span>
          <span>·</span>
          <span className="text-emerald-700">Safe: 4.0 mm</span>
        </div>
      )}
    </div>
  );
};

