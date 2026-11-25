import type {
  CardShapeElement,
  CardSideDesign,
  CardTextElement,
  MediaClipCircleSpec,
} from '../types';

export const CARD_TRIM_LANDSCAPE_MM = { width: 85.6, height: 54.0 };
export const CARD_TRIM_VERTICAL_MM = { width: 54.0, height: 85.6 };
export const CARD_BLEED_MM = 3.0;
export const CARD_SAFE_MARGIN_MM = 4.0;
export const PRINT_DPI = 300;

export const CARD_PREVIEW_BASE_WIDTH_PX = {
  landscape: 440,
  vertical: 270,
} as const;

export type SelectableCardTarget =
  | { kind: 'text'; id: string }
  | { kind: 'shape'; id: string }
  | { kind: 'logo' }
  | { kind: 'avatar' }
  | { kind: 'qr' }
  | { kind: 'nfc' };

export type AlignAction = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function getCardTrimMm(orientation: 'landscape' | 'vertical') {
  return orientation === 'vertical' ? CARD_TRIM_VERTICAL_MM : CARD_TRIM_LANDSCAPE_MM;
}

export function getStudioBaseWidthPx(orientation: 'landscape' | 'vertical'): number {
  return orientation === 'vertical'
    ? CARD_PREVIEW_BASE_WIDTH_PX.vertical
    : CARD_PREVIEW_BASE_WIDTH_PX.landscape;
}

/**
 * Shared font scale ratio relative to card trim width so HTML preview (`cqw`)
 * and 300 DPI canvas export render at exact 1:1 visual proportions.
 */
export function getFontWidthRatio(fontSizePt: number, orientation: 'landscape' | 'vertical'): number {
  const basePx = getStudioBaseWidthPx(orientation);
  const studioPx = Math.max(8, fontSizePt * 1.35);
  return studioPx / basePx;
}

export function getElementBoxMetrics(el: CardTextElement): {
  leftPct: number;
  topPct: number;
  widthPct: number;
} {
  const leftPct = Number.isFinite(el.xPct) ? el.xPct : 8;
  const topPct = Number.isFinite(el.yPct) ? el.yPct : 10;
  const requestedWidth = Math.max(12, Math.min(95, el.maxWidthPct || 82));
  // Clamp width so right edge never runs past trim boundary (98%) when left >= 0
  const maxAvailable = Math.max(12, 98 - Math.max(0, leftPct));
  const widthPct = Math.min(requestedWidth, maxAvailable);
  return { leftPct, topPct, widthPct };
}

export function mmToTrimWidthPct(mm: number, orientation: 'landscape' | 'vertical'): number {
  const trim = getCardTrimMm(orientation);
  return (mm / trim.width) * 100;
}

export function mmToTrimHeightPct(mm: number, orientation: 'landscape' | 'vertical'): number {
  const trim = getCardTrimMm(orientation);
  return (mm / trim.height) * 100;
}

/**
 * Resolves circular clipping bounds for photo/logo elements inside medallion templates
 * (such as Classic Dog Tag) so enlarged photos/logos remain strictly inside the inner circle
 * behind the ring border.
 */
export function resolveSideMediaClipCircle(side: CardSideDesign): MediaClipCircleSpec | undefined {
  if (side.mediaClipCircle) return side.mediaClipCircle;
  const dogCenter = (side.shapes || []).find((s) => s.id === 's-dog-f-center' && s.kind === 'circle');
  if (dogCenter) {
    return {
      xPct: dogCenter.xPct,
      yPct: dogCenter.yPct,
      widthPct: dogCenter.widthPct,
      heightPct: dogCenter.heightPct,
      borderColor: dogCenter.borderColor || '#FFFFFF',
      borderWidthPx: dogCenter.borderWidthPx ?? 2,
    };
  }
  return undefined;
}

export function getTargetKey(target: SelectableCardTarget): string {
  if (target.kind === 'text' || target.kind === 'shape') {
    return `${target.kind}:${target.id}`;
  }
  return target.kind;
}

export function isSameTarget(a: SelectableCardTarget, b: SelectableCardTarget): boolean {
  return getTargetKey(a) === getTargetKey(b);
}

/**
 * Wraps multi-line and single-line text cleanly into lines that fit within `maxWidthPx`,
 * preserving explicit line breaks and breaking overly long continuous tokens (e.g. URLs/emails).
 */
export function wrapCanvasTextLines(
  measureWidth: (text: string) => number,
  text: string,
  maxWidthPx: number
): string[] {
  const safeMax = Math.max(12, maxWidthPx);
  const rawParagraphs = (text || '').split(/\r?\n/);
  const lines: string[] = [];

  for (const para of rawParagraphs) {
    const trimmed = para.trimEnd();
    if (!trimmed) {
      lines.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (measureWidth(candidate) <= safeMax) {
        currentLine = candidate;
        continue;
      }

      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }

      // If single word/token is wider than maxWidth, break by character cleanly
      if (measureWidth(word) > safeMax) {
        let chunk = '';
        for (const ch of word) {
          const nextChunk = chunk + ch;
          if (measureWidth(nextChunk) <= safeMax || !chunk) {
            chunk = nextChunk;
          } else {
            lines.push(chunk);
            chunk = ch;
          }
        }
        currentLine = chunk;
      } else {
        currentLine = word;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Generates vertices (0..100 coordinate space) for an irregular jagged 7-point safety starburst badge.
 */
export function getStarburstPolygonPoints(points = 7): Array<[number, number]> {
  const outerRadii = [49, 44, 48, 42, 49, 45, 47];
  const innerRadii = [19, 16, 21, 17, 19, 16, 20];
  const verts: Array<[number, number]> = [];
  const totalSteps = points * 2;
  for (let i = 0; i < totalSteps; i++) {
    const angle = (-Math.PI / 2) + (i * Math.PI) / points;
    const isOuter = i % 2 === 0;
    const r = isOuter
      ? outerRadii[Math.floor(i / 2) % outerRadii.length]
      : innerRadii[Math.floor(i / 2) % innerRadii.length];
    verts.push([
      Number((50 + r * Math.cos(angle)).toFixed(2)),
      Number((50 + r * Math.sin(angle)).toFixed(2)),
    ]);
  }
  return verts;
}

export interface CurvedTextArcGeometry {
  cx: number;
  cy: number;
  radius: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  sweepFlag: 0 | 1;
  startAngleRad: number;
  endAngleRad: number;
  centerAngleRad: number;
  direction: 1 | -1;
}

/**
 * Shared circle-arc geometry in millimeter/card-unit space (`cardW x cardH`)
 * so CardCanvasPreview SVG <textPath> and 300 DPI canvas character-by-character curves match 1:1.
 * - curveDeg > 0 arches upward (convex top arc, e.g. PLUTO / I AM LOST / SCAN ME)
 * - curveDeg < 0 cups upward along the bottom (concave bottom arc, e.g. PEOPLE FRIENDLY / I NEED HELP)
 */
export function getCurvedTextArcGeometry(params: {
  xPct: number;
  yPct: number;
  maxWidthPct?: number;
  fontSizeMm: number;
  curveDeg: number;
  cardW: number;
  cardH: number;
}): CurvedTextArcGeometry {
  const left = (params.xPct / 100) * params.cardW;
  const top = (params.yPct / 100) * params.cardH;
  const boxW = (Math.max(12, Math.min(95, params.maxWidthPct || 82)) / 100) * params.cardW;
  const cx = left + boxW / 2;

  const clampedDeg = Math.max(-140, Math.min(140, params.curveDeg));
  const absRad = Math.max(0.08, (Math.abs(clampedDeg) * Math.PI) / 180);
  const halfAngle = Math.min(Math.PI * 0.45, absRad / 2);
  const radius = Math.max(params.fontSizeMm * 1.6, boxW / (2 * Math.sin(halfAngle)));

  const isTopArch = clampedDeg > 0;
  const baselineApexY = isTopArch
    ? top + params.fontSizeMm * 0.95
    : top + params.fontSizeMm * 1.15;
  const cy = isTopArch ? baselineApexY + radius : baselineApexY - radius;
  const centerAngleRad = isTopArch ? -Math.PI / 2 : Math.PI / 2;
  const direction: 1 | -1 = isTopArch ? 1 : -1;
  const startAngleRad = centerAngleRad - direction * halfAngle;
  const endAngleRad = centerAngleRad + direction * halfAngle;

  return {
    cx,
    cy,
    radius,
    startX: cx + radius * Math.cos(startAngleRad),
    startY: cy + radius * Math.sin(startAngleRad),
    endX: cx + radius * Math.cos(endAngleRad),
    endY: cy + radius * Math.sin(endAngleRad),
    sweepFlag: isTopArch ? 1 : 0,
    startAngleRad,
    endAngleRad,
    centerAngleRad,
    direction,
  };
}

export interface TargetBoundsPct {
  target: SelectableCardTarget;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export function getTargetBoundsPct(
  side: CardSideDesign,
  target: SelectableCardTarget,
  orientation: 'landscape' | 'vertical'
): TargetBoundsPct | null {
  if (target.kind === 'text') {
    const el = side.elements.find((e) => e.id === target.id);
    if (!el) return null;
    const box = getElementBoxMetrics(el);
    // Approximate text height % based on fontSizePt & orientation trim height
    const trim = getCardTrimMm(orientation);
    const estHeightMm = Math.max(3.5, (el.fontSizePt * 1.45) * 0.3528);
    const hPct = Math.min(25, (estHeightMm / trim.height) * 100);
    return { target, xPct: box.leftPct, yPct: box.topPct, wPct: box.widthPct, hPct };
  }
  if (target.kind === 'shape') {
    const shp = (side.shapes || []).find((s) => s.id === target.id);
    if (!shp) return null;
    return {
      target,
      xPct: shp.xPct,
      yPct: shp.yPct,
      wPct: shp.widthPct,
      hPct: Math.max(0.8, shp.heightPct),
    };
  }
  if (target.kind === 'logo') {
    if (!side.logoDataUrl) return null;
    const wPct = mmToTrimWidthPct(side.logoWidthMm || 14, orientation);
    return { target, xPct: side.logoX, yPct: side.logoY, wPct, hPct: wPct * 0.65 };
  }
  if (target.kind === 'avatar') {
    if (!side.showAvatar) return null;
    const wPct = mmToTrimWidthPct(side.avatarSizeMm || 13, orientation);
    const hPct = mmToTrimHeightPct(side.avatarSizeMm || 13, orientation);
    return { target, xPct: side.avatarX, yPct: side.avatarY, wPct, hPct };
  }
  if (target.kind === 'qr') {
    if (!side.showQrSlot) return null;
    const wPct = mmToTrimWidthPct(side.qrSizeMm || 17, orientation);
    const hPct = mmToTrimHeightPct(side.qrSizeMm || 17, orientation);
    return { target, xPct: side.qrSlotX, yPct: side.qrSlotY, wPct, hPct };
  }
  if (target.kind === 'nfc') {
    if (!side.showNfcIcon) return null;
    const wPct = mmToTrimWidthPct((side.nfcSizeMm || 6) * 1.4, orientation);
    const hPct = mmToTrimHeightPct((side.nfcSizeMm || 6) * 1.4, orientation);
    return { target, xPct: side.nfcX ?? 88, yPct: side.nfcY ?? 10, wPct, hPct };
  }
  return null;
}

export function getAllSideTargets(side: CardSideDesign): SelectableCardTarget[] {
  const list: SelectableCardTarget[] = [];
  for (const el of side.elements) list.push({ kind: 'text', id: el.id });
  for (const shp of side.shapes || []) list.push({ kind: 'shape', id: shp.id });
  if (side.logoDataUrl) list.push({ kind: 'logo' });
  if (side.showAvatar) list.push({ kind: 'avatar' });
  if (side.showQrSlot) list.push({ kind: 'qr' });
  if (side.showNfcIcon) list.push({ kind: 'nfc' });
  return list;
}

/**
 * Computes live magnetic snap guidelines while dragging an object on the canvas.
 * Snaps to card center (50% X/Y), safe margins (7.5% / 92.5%), and other elements' edges/centers.
 */
export function computeSnapAndGuidelines(params: {
  side: CardSideDesign;
  movingTarget: SelectableCardTarget;
  candidateX: number;
  candidateY: number;
  orientation: 'landscape' | 'vertical';
  snapThresholdPct?: number;
}): {
  snappedX: number;
  snappedY: number;
  verticalGuides: number[];
  horizontalGuides: number[];
} {
  const threshold = params.snapThresholdPct ?? 1.4;
  const movingBounds = getTargetBoundsPct(params.side, params.movingTarget, params.orientation);
  if (!movingBounds) {
    return {
      snappedX: params.candidateX,
      snappedY: params.candidateY,
      verticalGuides: [],
      horizontalGuides: [],
    };
  }

  const mw = movingBounds.wPct;
  const mh = movingBounds.hPct;

  const refXPoints = new Set<number>([7.5, 50, 92.5]);
  const refYPoints = new Set<number>([7.5, 50, 92.5]);

  for (const t of getAllSideTargets(params.side)) {
    if (isSameTarget(t, params.movingTarget)) continue;
    const b = getTargetBoundsPct(params.side, t, params.orientation);
    if (!b) continue;
    refXPoints.add(Number(b.xPct.toFixed(2)));
    refXPoints.add(Number((b.xPct + b.wPct / 2).toFixed(2)));
    refXPoints.add(Number((b.xPct + b.wPct).toFixed(2)));

    refYPoints.add(Number(b.yPct.toFixed(2)));
    refYPoints.add(Number((b.yPct + b.hPct / 2).toFixed(2)));
    refYPoints.add(Number((b.yPct + b.hPct).toFixed(2)));
  }

  let bestX = params.candidateX;
  let bestDx = threshold + 1;
  const verticalGuides: number[] = [];

  // Test moving object's left, center, and right against reference X coordinates
  for (const refX of refXPoints) {
    const anchors = [
      { edge: params.candidateX, offset: 0 },
      { edge: params.candidateX + mw / 2, offset: mw / 2 },
      { edge: params.candidateX + mw, offset: mw },
    ];
    for (const a of anchors) {
      const diff = Math.abs(a.edge - refX);
      if (diff <= threshold && diff < bestDx) {
        bestDx = diff;
        bestX = Number((refX - a.offset).toFixed(2));
      }
    }
  }

  if (bestDx <= threshold) {
    for (const refX of refXPoints) {
      if (
        Math.abs(bestX - refX) < 0.25 ||
        Math.abs(bestX + mw / 2 - refX) < 0.25 ||
        Math.abs(bestX + mw - refX) < 0.25
      ) {
        verticalGuides.push(refX);
      }
    }
  }

  let bestY = params.candidateY;
  let bestDy = threshold + 1;
  const horizontalGuides: number[] = [];

  for (const refY of refYPoints) {
    const anchors = [
      { edge: params.candidateY, offset: 0 },
      { edge: params.candidateY + mh / 2, offset: mh / 2 },
      { edge: params.candidateY + mh, offset: mh },
    ];
    for (const a of anchors) {
      const diff = Math.abs(a.edge - refY);
      if (diff <= threshold && diff < bestDy) {
        bestDy = diff;
        bestY = Number((refY - a.offset).toFixed(2));
      }
    }
  }

  if (bestDy <= threshold) {
    for (const refY of refYPoints) {
      if (
        Math.abs(bestY - refY) < 0.25 ||
        Math.abs(bestY + mh / 2 - refY) < 0.25 ||
        Math.abs(bestY + mh - refY) < 0.25
      ) {
        horizontalGuides.push(refY);
      }
    }
  }

  return {
    snappedX: bestX,
    snappedY: bestY,
    verticalGuides,
    horizontalGuides,
  };
}

/**
 * Aligns 1 or more selected elements on a card side.
 * - When 1 element is selected: aligns relative to safe trim bounds (4%..96% or center 50%).
 * - When 2+ elements are selected: aligns all selected elements to the union bounding box.
 */
export function alignTargetsOnSide(
  side: CardSideDesign,
  targets: SelectableCardTarget[],
  action: AlignAction,
  orientation: 'landscape' | 'vertical'
): CardSideDesign {
  const boundsList = targets
    .map((t) => getTargetBoundsPct(side, t, orientation))
    .filter((b): b is TargetBoundsPct => b !== null);

  if (boundsList.length === 0) return side;

  const isMulti = boundsList.length > 1;
  const refLeft = isMulti ? Math.min(...boundsList.map((b) => b.xPct)) : 4;
  const refRight = isMulti ? Math.max(...boundsList.map((b) => b.xPct + b.wPct)) : 96;
  const refTop = isMulti ? Math.min(...boundsList.map((b) => b.yPct)) : 5;
  const refBottom = isMulti ? Math.max(...boundsList.map((b) => b.yPct + b.hPct)) : 95;
  const refCenterX = isMulti ? (refLeft + refRight) / 2 : 50;
  const refMiddleY = isMulti ? (refTop + refBottom) / 2 : 50;

  let nextSide: CardSideDesign = {
    ...side,
    elements: [...side.elements],
    shapes: [...(side.shapes || [])],
  };

  for (const b of boundsList) {
    let nextX = b.xPct;
    let nextY = b.yPct;

    if (action === 'left') nextX = refLeft;
    else if (action === 'center') nextX = refCenterX - b.wPct / 2;
    else if (action === 'right') nextX = refRight - b.wPct;
    else if (action === 'top') nextY = refTop;
    else if (action === 'middle') nextY = refMiddleY - b.hPct / 2;
    else if (action === 'bottom') nextY = refBottom - b.hPct;

    nextX = Number(Math.max(-20, Math.min(95, nextX)).toFixed(2));
    nextY = Number(Math.max(-20, Math.min(95, nextY)).toFixed(2));

    const t = b.target;
    if (t.kind === 'text') {
      nextSide = {
        ...nextSide,
        elements: nextSide.elements.map((el) =>
          el.id === t.id
            ? {
                ...el,
                xPct: Math.max(0, Math.min(92, nextX)),
                yPct: Math.max(0, Math.min(92, nextY)),
                ...(action === 'left' || action === 'center' || action === 'right'
                  ? { align: action }
                  : {}),
              }
            : el
        ),
      };
    } else if (t.kind === 'shape') {
      nextSide = {
        ...nextSide,
        shapes: (nextSide.shapes || []).map((s) =>
          s.id === t.id ? { ...s, xPct: nextX, yPct: nextY } : s
        ),
      };
    } else if (t.kind === 'logo') {
      nextSide = { ...nextSide, logoX: Math.max(0, Math.min(92, nextX)), logoY: Math.max(0, Math.min(92, nextY)) };
    } else if (t.kind === 'avatar') {
      nextSide = { ...nextSide, avatarX: Math.max(0, Math.min(92, nextX)), avatarY: Math.max(0, Math.min(92, nextY)) };
    } else if (t.kind === 'qr') {
      nextSide = { ...nextSide, qrSlotX: Math.max(0, Math.min(92, nextX)), qrSlotY: Math.max(0, Math.min(92, nextY)) };
    } else if (t.kind === 'nfc') {
      nextSide = { ...nextSide, nfcX: Math.max(0, Math.min(95, nextX)), nfcY: Math.max(0, Math.min(95, nextY)) };
    }
  }

  return nextSide;
}

/**
 * Nudges selected targets by `dxPct` / `dyPct` (for keyboard Arrow / Ctrl+Arrow controls).
 */
export function nudgeTargetsOnSide(
  side: CardSideDesign,
  targets: SelectableCardTarget[],
  dxPct: number,
  dyPct: number
): CardSideDesign {
  if (targets.length === 0) return side;
  const textIds = new Set(targets.filter((t) => t.kind === 'text').map((t) => (t as { id: string }).id));
  const shapeIds = new Set(targets.filter((t) => t.kind === 'shape').map((t) => (t as { id: string }).id));
  const hasLogo = targets.some((t) => t.kind === 'logo');
  const hasAvatar = targets.some((t) => t.kind === 'avatar');
  const hasQr = targets.some((t) => t.kind === 'qr');
  const hasNfc = targets.some((t) => t.kind === 'nfc');

  const clampStd = (v: number) => Number(Math.max(0, Math.min(92, v)).toFixed(2));
  const hasMediaClip = Boolean(resolveSideMediaClipCircle(side));
  const clampMedia = (v: number) =>
    hasMediaClip ? Number(Math.max(-35, Math.min(95, v)).toFixed(2)) : clampStd(v);
  const clampShape = (v: number) => Number(Math.max(-25, Math.min(98, v)).toFixed(2));

  return {
    ...side,
    elements: side.elements.map((el) =>
      textIds.has(el.id)
        ? { ...el, xPct: clampStd(el.xPct + dxPct), yPct: clampStd(el.yPct + dyPct) }
        : el
    ),
    shapes: (side.shapes || []).map((s) =>
      shapeIds.has(s.id)
        ? { ...s, xPct: clampShape(s.xPct + dxPct), yPct: clampShape(s.yPct + dyPct) }
        : s
    ),
    ...(hasLogo
      ? { logoX: clampMedia((side.logoX ?? 8) + dxPct), logoY: clampMedia((side.logoY ?? 12) + dyPct) }
      : {}),
    ...(hasAvatar
      ? { avatarX: clampMedia((side.avatarX ?? 8) + dxPct), avatarY: clampMedia((side.avatarY ?? 12) + dyPct) }
      : {}),
    ...(hasQr
      ? { qrSlotX: clampStd((side.qrSlotX ?? 68) + dxPct), qrSlotY: clampStd((side.qrSlotY ?? 22) + dyPct) }
      : {}),
    ...(hasNfc
      ? { nfcX: clampStd((side.nfcX ?? 88) + dxPct), nfcY: clampStd((side.nfcY ?? 10) + dyPct) }
      : {}),
  };
}

export type ElementHistoryTarget = SelectableCardTarget | { kind: 'background' };

export type CardElementSnapshot =
  | { kind: 'text'; id: string; element: CardTextElement }
  | { kind: 'shape'; id: string; shape: CardShapeElement }
  | {
      kind: 'avatar';
      showAvatar?: boolean;
      avatarX: number;
      avatarY: number;
      avatarSizeMm?: number;
      avatarShape?: CardSideDesign['avatarShape'];
      showAvatarBorder?: boolean;
      avatarBorderColor?: string;
      avatarDataUrl?: string;
    }
  | {
      kind: 'logo';
      logoDataUrl?: string;
      logoX: number;
      logoY: number;
      logoWidthMm: number;
    }
  | {
      kind: 'qr';
      showQrSlot: boolean;
      qrSlotX: number;
      qrSlotY: number;
      qrSizeMm: number;
    }
  | {
      kind: 'nfc';
      showNfcIcon: boolean;
      nfcX?: number;
      nfcY?: number;
      nfcSizeMm?: number;
      nfcIconColor: CardSideDesign['nfcIconColor'];
    }
  | {
      kind: 'background';
      backgroundColor: string;
      gradientTo?: string;
      backgroundImageUrl?: string;
      showBorder?: boolean;
      borderColor?: string;
      borderWidthPx?: number;
    };

export function getElementHistoryKey(
  sideName: 'front' | 'back',
  target: ElementHistoryTarget
): string {
  if (target.kind === 'text' || target.kind === 'shape') {
    return `${sideName}:${target.kind}:${target.id}`;
  }
  return `${sideName}:${target.kind}`;
}

export function extractElementSnapshot(
  side: CardSideDesign,
  target: ElementHistoryTarget
): CardElementSnapshot | null {
  if (target.kind === 'text') {
    const el = side.elements.find((item) => item.id === target.id);
    if (!el) return null;
    return { kind: 'text', id: el.id, element: { ...el } };
  }
  if (target.kind === 'shape') {
    const shp = (side.shapes || []).find((item) => item.id === target.id);
    if (!shp) return null;
    return { kind: 'shape', id: shp.id, shape: { ...shp } };
  }
  if (target.kind === 'avatar') {
    return {
      kind: 'avatar',
      showAvatar: side.showAvatar,
      avatarX: side.avatarX,
      avatarY: side.avatarY,
      avatarSizeMm: side.avatarSizeMm,
      avatarShape: side.avatarShape,
      showAvatarBorder: side.showAvatarBorder,
      avatarBorderColor: side.avatarBorderColor,
      avatarDataUrl: side.avatarDataUrl,
    };
  }
  if (target.kind === 'logo') {
    return {
      kind: 'logo',
      logoDataUrl: side.logoDataUrl,
      logoX: side.logoX,
      logoY: side.logoY,
      logoWidthMm: side.logoWidthMm,
    };
  }
  if (target.kind === 'qr') {
    return {
      kind: 'qr',
      showQrSlot: side.showQrSlot,
      qrSlotX: side.qrSlotX,
      qrSlotY: side.qrSlotY,
      qrSizeMm: side.qrSizeMm,
    };
  }
  if (target.kind === 'nfc') {
    return {
      kind: 'nfc',
      showNfcIcon: side.showNfcIcon,
      nfcX: side.nfcX,
      nfcY: side.nfcY,
      nfcSizeMm: side.nfcSizeMm,
      nfcIconColor: side.nfcIconColor,
    };
  }
  return {
    kind: 'background',
    backgroundColor: side.backgroundColor,
    gradientTo: side.gradientTo,
    backgroundImageUrl: side.backgroundImageUrl,
    showBorder: side.showBorder,
    borderColor: side.borderColor,
    borderWidthPx: side.borderWidthPx,
  };
}

export function applyElementSnapshot(
  side: CardSideDesign,
  snapshot: CardElementSnapshot
): CardSideDesign {
  if (snapshot.kind === 'text') {
    const exists = side.elements.some((el) => el.id === snapshot.id);
    return {
      ...side,
      elements: exists
        ? side.elements.map((el) => (el.id === snapshot.id ? { ...snapshot.element } : el))
        : [...side.elements, { ...snapshot.element }],
    };
  }
  if (snapshot.kind === 'shape') {
    const shapes = side.shapes || [];
    const exists = shapes.some((shp) => shp.id === snapshot.id);
    return {
      ...side,
      shapes: exists
        ? shapes.map((shp) => (shp.id === snapshot.id ? { ...snapshot.shape } : shp))
        : [...shapes, { ...snapshot.shape }],
    };
  }
  if (snapshot.kind === 'avatar') {
    return {
      ...side,
      showAvatar: snapshot.showAvatar,
      avatarX: snapshot.avatarX,
      avatarY: snapshot.avatarY,
      avatarSizeMm: snapshot.avatarSizeMm,
      avatarShape: snapshot.avatarShape,
      showAvatarBorder: snapshot.showAvatarBorder,
      avatarBorderColor: snapshot.avatarBorderColor,
      avatarDataUrl: snapshot.avatarDataUrl,
    };
  }
  if (snapshot.kind === 'logo') {
    return {
      ...side,
      logoDataUrl: snapshot.logoDataUrl,
      logoX: snapshot.logoX,
      logoY: snapshot.logoY,
      logoWidthMm: snapshot.logoWidthMm,
    };
  }
  if (snapshot.kind === 'qr') {
    return {
      ...side,
      showQrSlot: snapshot.showQrSlot,
      qrSlotX: snapshot.qrSlotX,
      qrSlotY: snapshot.qrSlotY,
      qrSizeMm: snapshot.qrSizeMm,
    };
  }
  if (snapshot.kind === 'nfc') {
    return {
      ...side,
      showNfcIcon: snapshot.showNfcIcon,
      nfcX: snapshot.nfcX,
      nfcY: snapshot.nfcY,
      nfcSizeMm: snapshot.nfcSizeMm,
      nfcIconColor: snapshot.nfcIconColor ?? side.nfcIconColor,
    };
  }
  return {
    ...side,
    backgroundColor: snapshot.backgroundColor,
    gradientTo: snapshot.gradientTo,
    backgroundImageUrl: snapshot.backgroundImageUrl,
    showBorder: snapshot.showBorder,
    borderColor: snapshot.borderColor,
    borderWidthPx: snapshot.borderWidthPx,
  };
}

export function areElementSnapshotsEqual(
  a: CardElementSnapshot | null | undefined,
  b: CardElementSnapshot | null | undefined
): boolean {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Resets ONLY the targeted element on `currentSide` back to its `originalSide`
 * template definition (or `fallbackSnapshot` for user-created elements), without
 * altering any other element or setting on the card.
 */
export function resetSingleElementOnSide(params: {
  currentSide: CardSideDesign;
  originalSide: CardSideDesign;
  target: ElementHistoryTarget;
  fallbackSnapshot?: CardElementSnapshot | null;
}): { nextSide: CardSideDesign; changed: boolean } {
  const { currentSide, originalSide, target, fallbackSnapshot } = params;
  const currentSnap = extractElementSnapshot(currentSide, target);
  if (!currentSnap) {
    return { nextSide: currentSide, changed: false };
  }

  let baselineSnap = extractElementSnapshot(originalSide, target);
  if (!baselineSnap && fallbackSnapshot && fallbackSnapshot.kind === target.kind) {
    baselineSnap = fallbackSnapshot;
  }

  // Fallback for previously saved custom elements that aren't in the base template
  if (!baselineSnap && currentSnap.kind === 'text') {
    const sampleColor = originalSide.elements[0]?.color || '#0B1D3A';
    baselineSnap = {
      kind: 'text',
      id: currentSnap.id,
      element: {
        ...currentSnap.element,
        fontSizePt: 9,
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: 'normal',
        fontStyle: 'normal',
        textDecoration: 'none',
        uppercase: false,
        curveDeg: 0,
        align: 'left',
        color: sampleColor,
      },
    };
  } else if (!baselineSnap && currentSnap.kind === 'shape') {
    baselineSnap = {
      kind: 'shape',
      id: currentSnap.id,
      shape: {
        ...currentSnap.shape,
        color: '#0B1D3A',
        gradientTo: undefined,
        rotationDeg: 0,
        borderWidthPx: 0,
        opacity: 1,
      },
    };
  }

  if (!baselineSnap || areElementSnapshotsEqual(currentSnap, baselineSnap)) {
    return { nextSide: currentSide, changed: false };
  }

  return {
    nextSide: applyElementSnapshot(currentSide, baselineSnap),
    changed: true,
  };
}

