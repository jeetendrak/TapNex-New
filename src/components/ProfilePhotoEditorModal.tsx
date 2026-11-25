import React, { useEffect, useRef, useState } from 'react';
import { Check, Maximize2, Minimize2, RotateCw, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ProfilePhotoEditorModalProps {
  open: boolean;
  imageSrc: string;
  onClose: () => void;
  onSave: (croppedDataUrl: string) => void;
  title?: string;
  frameShape?: 'circle' | 'rounded' | 'square';
}

const VIEWPORT_PX = 256;
const OUTPUT_PX = 420;

function isAlphaFriendlySource(src: string, img: HTMLImageElement): boolean {
  if (/^data:image\/(png|webp|svg\+xml)/i.test(src) || /\.(png|webp|svg)(\?|$)/i.test(src)) {
    return true;
  }
  try {
    const probeW = Math.min(64, Math.max(1, img.width));
    const probeH = Math.min(64, Math.max(1, img.height));
    const probe = document.createElement('canvas');
    probe.width = probeW;
    probe.height = probeH;
    const pCtx = probe.getContext('2d');
    if (!pCtx) return false;
    pCtx.drawImage(img, 0, 0, probeW, probeH);
    const pixels = pCtx.getImageData(0, 0, probeW, probeH).data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 250) return true;
    }
  } catch {
    // CORS-tainted remote image
  }
  return false;
}

export function autoFitImageToSquareDataUrl(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_PX;
      canvas.height = OUTPUT_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }
      const keepAlpha = isAlphaFriendlySource(src, img);
      if (keepAlpha) {
        ctx.clearRect(0, 0, OUTPUT_PX, OUTPUT_PX);
      } else {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, OUTPUT_PX, OUTPUT_PX);
      }

      const scale = Math.max(OUTPUT_PX / img.width, OUTPUT_PX / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const dx = (OUTPUT_PX - drawW) / 2;
      // Slightly bias vertical portraits upward so heads/eyes remain well-framed
      const dy = img.height > img.width ? (OUTPUT_PX - drawH) * 0.28 : (OUTPUT_PX - drawH) / 2;
      ctx.drawImage(img, dx, dy, drawW, drawH);
      resolve(keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

export const ProfilePhotoEditorModal: React.FC<ProfilePhotoEditorModalProps> = ({
  open,
  imageSrc,
  onClose,
  onSave,
  title = 'Crop & Adjust Profile Photo',
  frameShape = 'circle',
}) => {
  const [currentSrc, setCurrentSrc] = useState(imageSrc);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 1, h: 1 });
  const [zoom, setZoom] = useState(1); // 1 = autofit cover, <1 = show full photo inside circle, >1 = zoom in
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [dragging, setDragging] = useState<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setCurrentSrc(imageSrc);
  }, [imageSrc]);

  useEffect(() => {
    if (!open || !currentSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setNaturalSize({ w: img.width || 1, h: img.height || 1 });
      setZoom(1);
      setRotation(0);
      // Slight upward framing if portrait so face is centered inside circle
      const coverScale = Math.max(VIEWPORT_PX / img.width, VIEWPORT_PX / img.height);
      const renderedH = img.height * coverScale;
      const defaultY = img.height > img.width ? Math.min(0, (renderedH - VIEWPORT_PX) * 0.22) : 0;
      setOffset({ x: 0, y: defaultY });
    };
    img.src = currentSrc;
  }, [open, currentSrc]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: PointerEvent) => {
      setOffset({
        x: dragging.origX + (e.clientX - dragging.startX),
        y: dragging.origY + (e.clientY - dragging.startY),
      });
    };
    const handleUp = () => setDragging(null);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [dragging]);

  if (!open) return null;

  const effW = rotation % 180 === 0 ? naturalSize.w : naturalSize.h;
  const effH = rotation % 180 === 0 ? naturalSize.h : naturalSize.w;
  const coverScale = Math.max(VIEWPORT_PX / effW, VIEWPORT_PX / effH);
  const containScale = Math.min(VIEWPORT_PX / effW, VIEWPORT_PX / effH);
  const containZoomRatio = Math.max(0.45, Math.min(1, Number((containScale / coverScale).toFixed(2))));

  const handleAutoFitCover = () => {
    setZoom(1);
    const renderedH = effH * coverScale;
    setOffset({
      x: 0,
      y: effH > effW ? Math.min(0, (renderedH - VIEWPORT_PX) * 0.22) : 0,
    });
  };

  const handleFitWholePhoto = () => {
    setZoom(containZoomRatio);
    setOffset({ x: 0, y: 0 });
  };

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const url = await readImageFileAsDataUrl(f);
    if (url) setCurrentSrc(url);
  };

  const handleApply = async () => {
    const img = imgRef.current;
    if (!img) return;
    setSaving(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_PX;
      canvas.height = OUTPUT_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const keepAlpha = isAlphaFriendlySource(currentSrc, img);
      if (keepAlpha) {
        ctx.clearRect(0, 0, OUTPUT_PX, OUTPUT_PX);
      } else {
        // Soft light backdrop only for opaque photos when zoomed out
        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(0, 0, OUTPUT_PX, OUTPUT_PX);
      }

      const ratio = OUTPUT_PX / VIEWPORT_PX;
      const drawScale = coverScale * zoom * ratio;

      ctx.save();
      ctx.translate(OUTPUT_PX / 2 + offset.x * ratio, OUTPUT_PX / 2 + offset.y * ratio);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(
        img,
        -(img.width * drawScale) / 2,
        -(img.height * drawScale) / 2,
        img.width * drawScale,
        img.height * drawScale
      );
      ctx.restore();

      onSave(keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const previewW = naturalSize.w * coverScale * zoom;
  const previewH = naturalSize.h * coverScale * zoom;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-[#050814] text-white flex items-center justify-between">
          <div>
            <h2 className="font-display font-bold text-sm">{title}</h2>
            <p className="text-[11px] text-slate-300">
              Drag photo to reposition · Use zoom so every needed detail stays visible
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close photo editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Interactive Crop Frame */}
          <div className="flex flex-col items-center">
            <div
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging({
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: offset.x,
                  origY: offset.y,
                });
              }}
              style={{ width: VIEWPORT_PX, height: VIEWPORT_PX }}
              className="relative overflow-hidden rounded-2xl bg-[linear-gradient(45deg,#1e293b_25%,transparent_25%),linear-gradient(-45deg,#1e293b_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1e293b_75%),linear-gradient(-45deg,transparent_75%,#1e293b_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px] bg-slate-900 border border-slate-300 cursor-move touch-none select-none shadow-inner"
            >
              {currentSrc && (
                <img
                  src={currentSrc}
                  alt="Crop preview"
                  draggable={false}
                  style={{
                    width: `${previewW}px`,
                    height: `${previewH}px`,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) rotate(${rotation}deg)`,
                  }}
                  className="pointer-events-none select-none"
                />
              )}

              {/* Frame guide overlay matching selected output shape */}
              <div
                className={`pointer-events-none absolute inset-0 ${
                  frameShape === 'circle'
                    ? 'rounded-full'
                    : frameShape === 'rounded'
                    ? 'rounded-2xl'
                    : 'rounded-none'
                } border-2 border-white/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.52)]`}
                aria-hidden="true"
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {frameShape === 'circle'
                ? 'Circle shows the exact area visible on your digital profile and SMART card'
                : frameShape === 'rounded'
                ? 'Rounded frame shows the exact area visible on your SMART card'
                : 'Square frame shows the exact area visible on your SMART card'}
            </p>
          </div>

          {/* Zoom & Size Controls */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700">
              <span className="inline-flex items-center gap-1">
                <ZoomOut className="h-3.5 w-3.5 text-slate-400" />
                <span>Zoom / Crop Size</span>
              </span>
              <span className="font-mono text-[11px] text-[#1D4ED8]">{Math.round(zoom * 100)}%</span>
            </div>
            <div className="flex items-center gap-2.5">
              <input
                type="range"
                min={0.45}
                max={3}
                step={0.02}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-[#1D4ED8]"
              />
              <ZoomIn className="h-4 w-4 text-slate-400 shrink-0" />
            </div>
          </div>

          {/* Quick Fit & Transform Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAutoFitCover}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>Auto-Fit Fill</span>
            </button>
            <button
              type="button"
              onClick={handleFitWholePhoto}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              <span>Fit Full Photo</span>
            </button>
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>Rotate 90°</span>
            </button>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer ml-auto">
              <Upload className="h-3.5 w-3.5" />
              <span>Change Photo</span>
              <input type="file" accept="image/*" onChange={handleReplaceFile} className="hidden" />
            </label>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !currentSrc}
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#0B1D3A] hover:bg-[#132A52] text-white text-xs font-semibold disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{saving ? 'Applying...' : 'Apply Photo'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
