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

  if (rawDataUrl.length <= maxChars && !preserveAlpha) {
    // Still normalize huge dimensions if needed; attempt canvas resize below
  }

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

  if (!preserveAlpha) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);
    for (const quality of [0.9, 0.82, 0.72, 0.62, 0.5]) {
      const encoded = canvas.toDataURL('image/jpeg', quality);
      if (encoded.length <= maxChars) return encoded;
    }
    return canvas.toDataURL('image/jpeg', 0.45);
  }

  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);
  const pngUrl = canvas.toDataURL('image/png');
  if (pngUrl.length <= maxChars) return pngUrl;

  for (const quality of [0.9, 0.8, 0.68, 0.55]) {
    const webpUrl = canvas.toDataURL('image/webp', quality);
    if (webpUrl.length <= maxChars && webpUrl.startsWith('data:image/webp')) return webpUrl;
  }

  // Fallback progressive PNG downscale to retain transparency everywhere
  let w = targetW;
  let h = targetH;
  for (let i = 0; i < 4; i++) {
    w = Math.max(64, Math.round(w * 0.78));
    h = Math.max(64, Math.round(h * 0.78));
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const resizedPng = canvas.toDataURL('image/png');
    if (resizedPng.length <= maxChars) return resizedPng;
  }
  return canvas.toDataURL('image/png');
}
