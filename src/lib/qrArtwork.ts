import QRCode from 'qrcode';

export interface QrArtworkResult {
  targetUrl: string;
  svgContent: string;
  pngDataUrl: string;
}

export function normalizeQrTargetUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Please enter a valid public URL.');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Please enter a valid URL starting with https:// or http://.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) {
    throw new Error('URL must be a valid public web address (e.g. https://tapnex.in/p/your-name).');
  }
  return parsed.toString();
}

export async function generateHighResQrArtwork(rawUrl: string, width = 1024): Promise<QrArtworkResult> {
  const targetUrl = normalizeQrTargetUrl(rawUrl);

  // Try Express backend endpoint when available (Node server mode), safely ignoring HTML fallbacks on static hosts (Netlify).
  if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
    try {
      const res = await fetch('/api/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl, width }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as { svgContent?: string; pngDataUrl?: string };
        if (data.svgContent && data.pngDataUrl) {
          return {
            targetUrl,
            svgContent: data.svgContent,
            pngDataUrl: data.pngDataUrl,
          };
        }
      }
    } catch {
      // Static hosting (e.g. Netlify) or offline: silently fall through to client-side QR generation.
    }
  }

  const svgContent = await QRCode.toString(targetUrl, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 4,
    width,
    color: { dark: '#0B1D3A', light: '#FFFFFF' },
  });

  let pngDataUrl = '';
  try {
    pngDataUrl = await QRCode.toDataURL(targetUrl, {
      errorCorrectionLevel: 'H',
      margin: 4,
      width,
      color: { dark: '#0B1D3A', light: '#FFFFFF' },
    });
  } catch {
    // Fallback for headless test environments without HTML5 canvas implementation
    const encodedSvg =
      typeof btoa === 'function'
        ? btoa(unescape(encodeURIComponent(svgContent)))
        : Buffer.from(svgContent, 'utf8').toString('base64');
    pngDataUrl = `data:image/svg+xml;base64,${encodedSvg}`;
  }

  return {
    targetUrl,
    svgContent,
    pngDataUrl,
  };
}

export function generatePrinterAuthId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `prt_${ts}_${rand}`;
}

export function canvasHasTransparentPixels(
  canvas: HTMLCanvasElement,
  fallbackOnError = false
): boolean {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallbackOnError;
    const probeW = Math.min(96, Math.max(1, canvas.width));
    const probeH = Math.min(96, Math.max(1, canvas.height));
    let data: Uint8ClampedArray;
    if (probeW === canvas.width && probeH === canvas.height) {
      data = ctx.getImageData(0, 0, probeW, probeH).data;
    } else {
      const probe = document.createElement('canvas');
      probe.width = probeW;
      probe.height = probeH;
      const pCtx = probe.getContext('2d');
      if (!pCtx) return fallbackOnError;
      pCtx.drawImage(canvas, 0, 0, probeW, probeH);
      data = pCtx.getImageData(0, 0, probeW, probeH).data;
    }
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
    return false;
  } catch {
    return fallbackOnError;
  }
}

export function imageHasTransparentPixels(
  src: string,
  img: HTMLImageElement
): boolean {
  try {
    const probeW = Math.min(96, Math.max(1, img.width));
    const probeH = Math.min(96, Math.max(1, img.height));
    const probe = document.createElement('canvas');
    probe.width = probeW;
    probe.height = probeH;
    const pCtx = probe.getContext('2d');
    if (!pCtx) return false;
    pCtx.clearRect(0, 0, probeW, probeH);
    pCtx.drawImage(img, 0, 0, probeW, probeH);
    const pixels = pCtx.getImageData(0, 0, probeW, probeH).data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 250) return true;
    }
    return false;
  } catch {
    // Only fall back to extension/MIME guess when CORS prevents pixel inspection
    return /^data:image\/(png|webp|svg\+xml)/i.test(src) || /\.(png|webp|svg)(\?|$)/i.test(src);
  }
}

function encodeOpaqueCanvasAsJpegWithinBudget(
  sourceCanvas: HTMLCanvasElement,
  maxChars: number,
  backdropColor = '#FFFFFF'
): string {
  const work = document.createElement('canvas');
  work.width = Math.max(1, sourceCanvas.width);
  work.height = Math.max(1, sourceCanvas.height);
  const wCtx = work.getContext('2d');
  if (!wCtx) return sourceCanvas.toDataURL('image/jpeg', 0.82);

  const fillAndDraw = (w: number, h: number) => {
    work.width = w;
    work.height = h;
    wCtx.fillStyle = backdropColor;
    wCtx.fillRect(0, 0, w, h);
    wCtx.drawImage(sourceCanvas, 0, 0, w, h);
  };

  fillAndDraw(work.width, work.height);
  for (const quality of [0.9, 0.82, 0.72, 0.62, 0.52, 0.42]) {
    const encoded = work.toDataURL('image/jpeg', quality);
    if (encoded.length <= maxChars) return encoded;
  }

  let w = work.width;
  let h = work.height;
  for (let step = 0; step < 8; step += 1) {
    w = Math.max(48, Math.round(w * 0.78));
    h = Math.max(48, Math.round(h * 0.78));
    fillAndDraw(w, h);
    for (const quality of [0.76, 0.62, 0.48, 0.36]) {
      const encoded = work.toDataURL('image/jpeg', quality);
      if (encoded.length <= maxChars) return encoded;
    }
    if (w <= 48 && h <= 48) break;
  }
  return work.toDataURL('image/jpeg', 0.36);
}

export function encodeCanvasWithinBudget(
  canvas: HTMLCanvasElement,
  options: { maxChars: number; preserveAlpha?: boolean; backdropColor?: string }
): string {
  const maxChars = Math.max(4_000, Math.floor(options.maxChars));
  const wantAlpha = Boolean(options.preserveAlpha) && canvasHasTransparentPixels(canvas, true);

  if (!wantAlpha) {
    return encodeOpaqueCanvasAsJpegWithinBudget(canvas, maxChars, options.backdropColor || '#FFFFFF');
  }

  const pngUrl = canvas.toDataURL('image/png');
  if (pngUrl.length <= maxChars) return pngUrl;

  for (const quality of [0.9, 0.8, 0.68, 0.55, 0.42]) {
    const webpUrl = canvas.toDataURL('image/webp', quality);
    if (webpUrl.startsWith('data:image/webp') && webpUrl.length <= maxChars) {
      return webpUrl;
    }
  }

  const work = document.createElement('canvas');
  const wCtx = work.getContext('2d');
  if (!wCtx) return pngUrl;

  let w = canvas.width;
  let h = canvas.height;
  for (let step = 0; step < 8; step += 1) {
    w = Math.max(48, Math.round(w * 0.78));
    h = Math.max(48, Math.round(h * 0.78));
    work.width = w;
    work.height = h;
    wCtx.clearRect(0, 0, w, h);
    wCtx.drawImage(canvas, 0, 0, w, h);

    const resizedPng = work.toDataURL('image/png');
    if (resizedPng.length <= maxChars) return resizedPng;

    for (const quality of [0.82, 0.66, 0.5, 0.38]) {
      const resizedWebp = work.toDataURL('image/webp', quality);
      if (resizedWebp.startsWith('data:image/webp') && resizedWebp.length <= maxChars) {
        return resizedWebp;
      }
    }
    if (w <= 48 && h <= 48) break;
  }

  // Final safety fallback if budget is extremely tight so caller never receives an oversized string
  const fallback = encodeOpaqueCanvasAsJpegWithinBudget(work, maxChars, options.backdropColor || '#FFFFFF');
  return fallback.length <= work.toDataURL('image/png').length ? fallback : work.toDataURL('image/png');
}

export async function compressDataUrlWithinBudget(
  dataUrl: string,
  options: { maxWidth?: number; maxHeight?: number; maxChars: number; preserveAlpha?: boolean }
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }
  const maxChars = Math.max(4_000, Math.floor(options.maxChars));
  if (dataUrl.length <= maxChars) {
    return dataUrl;
  }
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return dataUrl;
  }

  const maxWidth = options.maxWidth ?? 1082;
  const maxHeight = options.maxHeight ?? 1082;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Unsupported image format'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxWidth / Math.max(1, img.width), maxHeight / Math.max(1, img.height));
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  const hasAlpha = Boolean(options.preserveAlpha) && imageHasTransparentPixels(dataUrl, img);
  if (hasAlpha) {
    ctx.clearRect(0, 0, targetW, targetH);
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);

  return encodeCanvasWithinBudget(canvas, {
    maxChars,
    preserveAlpha: hasAlpha,
  });
}

export async function compressImageFileToDataUrl(
  file: File,
  options: { maxWidth?: number; maxHeight?: number; maxChars?: number; preserveAlpha?: boolean } = {}
): Promise<string> {
  const maxWidth = options.maxWidth ?? 1082;
  const maxHeight = options.maxHeight ?? 1082;
  const maxChars = options.maxChars ?? 320_000;
  const preserveAlpha = options.preserveAlpha ?? false;

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return rawDataUrl;
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Unsupported image format'));
    el.src = rawDataUrl;
  });

  const scale = Math.min(1, maxWidth / Math.max(1, img.width), maxHeight / Math.max(1, img.height));
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return rawDataUrl;

  const keepAlpha = preserveAlpha && imageHasTransparentPixels(rawDataUrl, img);
  if (keepAlpha) {
    ctx.clearRect(0, 0, targetW, targetH);
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);

  return encodeCanvasWithinBudget(canvas, {
    maxChars,
    preserveAlpha: keepAlpha,
  });
}
