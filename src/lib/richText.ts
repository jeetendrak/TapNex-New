const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'p', 'div', 'br', 'span']);
const SAFE_ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);

const PALETTE_STORAGE_KEY = 'tapnex_saved_color_palette_v1';

export const DEFAULT_BRAND_PALETTE = [
  '#0B1D3A',
  '#1D4ED8',
  '#38BDF8',
  '#D4AF37',
  '#FFFFFF',
  '#0F172A',
  '#475569',
  '#E2E8F0',
];

export function normalizeHexColor(input: string): string | null {
  const cleaned = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    const expanded = cleaned
      .split('')
      .map((c) => `${c}${c}`)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }
  return null;
}

export function getSavedColorPalette(): string[] {
  if (typeof localStorage === 'undefined') return DEFAULT_BRAND_PALETTE;
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (!raw) return DEFAULT_BRAND_PALETTE;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_BRAND_PALETTE;
    const valid = parsed
      .map((item) => (typeof item === 'string' ? normalizeHexColor(item) : null))
      .filter((c): c is string => Boolean(c));
    return valid.length > 0 ? valid.slice(0, 18) : DEFAULT_BRAND_PALETTE;
  } catch {
    return DEFAULT_BRAND_PALETTE;
  }
}

export function addColorToPalette(colorInput: string): string[] {
  const normalized = normalizeHexColor(colorInput);
  const current = getSavedColorPalette();
  if (!normalized) return current;
  const next = [normalized, ...current.filter((c) => c.toUpperCase() !== normalized)].slice(0, 18);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota failure
    }
  }
  return next;
}

function sanitizeInlineStyle(rawStyle: string): string {
  const safeParts: string[] = [];
  for (const decl of rawStyle.split(';')) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    const val = decl.slice(colonIdx + 1).trim();

    if (prop === 'color') {
      const hex = normalizeHexColor(val);
      if (hex) {
        safeParts.push(`color: ${hex}`);
      } else {
        const rgbMatch = val.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
        if (rgbMatch) {
          const r = Math.min(255, Number(rgbMatch[1]));
          const g = Math.min(255, Number(rgbMatch[2]));
          const b = Math.min(255, Number(rgbMatch[3]));
          safeParts.push(`color: rgb(${r}, ${g}, ${b})`);
        }
      }
    } else if (prop === 'text-align') {
      const low = val.toLowerCase();
      if (SAFE_ALIGNMENTS.has(low)) {
        safeParts.push(`text-align: ${low}`);
      }
    } else if (prop === 'font-weight') {
      const low = val.toLowerCase();
      if (['bold', 'normal', '600', '700', '400'].includes(low)) {
        safeParts.push(`font-weight: ${low}`);
      }
    } else if (prop === 'font-style') {
      const low = val.toLowerCase();
      if (['italic', 'normal'].includes(low)) {
        safeParts.push(`font-style: ${low}`);
      }
    } else if (prop === 'text-decoration' || prop === 'text-decoration-line') {
      const low = val.toLowerCase();
      if (['underline', 'none'].includes(low)) {
        safeParts.push(`text-decoration: ${low}`);
      }
    }
  }
  return safeParts.join('; ');
}

function escapeHtmlText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Strictly sanitizes rich HTML biography strings using an allowlist of safe formatting tags
 * and validated CSS properties. Removes all scripts, event handlers, and unsafe tags cleanly
 * without relying on DOM APIs so it behaves identically in React and Node/Vitest.
 */
export function sanitizeRichBioHtml(rawHtml?: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  let input = rawHtml.trim();
  if (!input) return '';

  // Strip dangerous script/style/iframe/svg/object blocks including inner content
  input = input.replace(
    /<\s*(script|style|iframe|object|embed|svg|math|noscript|textarea)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ''
  );

  // Convert legacy <font color="..."> from execCommand('foreColor') into <span style="color: ...">
  input = input.replace(
    /<font\b([^>]*)>/gi,
    (_m, attrs: string) => {
      const colorMatch = attrs.match(/\bcolor\s*=\s*["']?([^"'\s>]+)["']?/i);
      if (colorMatch) {
        const hex = normalizeHexColor(colorMatch[1]);
        if (hex) return `<span style="color: ${hex}">`;
      }
      return '<span>';
    }
  );
  input = input.replace(/<\/font\s*>/gi, '</span>');

  // Parse tags and allow only ALLOWED_TAGS with optional sanitized style/align
  const out: string[] = [];
  const tagRegex = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      out.push(input.slice(lastIndex, match.index));
    }
    lastIndex = tagRegex.lastIndex;

    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const attrs = match[2] || '';
    const isClosing = fullTag.startsWith('</');

    if (!ALLOWED_TAGS.has(tagName)) {
      continue;
    }

    if (isClosing) {
      if (tagName !== 'br') {
        out.push(`</${tagName}>`);
      }
      continue;
    }

    if (tagName === 'br') {
      out.push('<br />');
      continue;
    }

    // Extract safe style + align attributes
    const styleMatch = attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const alignMatch = attrs.match(/\balign\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z]+))/i);
    let safeStyle = sanitizeInlineStyle((styleMatch?.[1] || styleMatch?.[2] || '').trim());
    const legacyAlign = (alignMatch?.[1] || alignMatch?.[2] || alignMatch?.[3] || '').toLowerCase();
    if (SAFE_ALIGNMENTS.has(legacyAlign) && !safeStyle.includes('text-align')) {
      safeStyle = safeStyle ? `${safeStyle}; text-align: ${legacyAlign}` : `text-align: ${legacyAlign}`;
    }

    out.push(safeStyle ? `<${tagName} style="${safeStyle}">` : `<${tagName}>`);
  }

  if (lastIndex < input.length) {
    out.push(input.slice(lastIndex));
  }

  const sanitized = out.join('').trim();
  // If user entered plain text without any HTML tags, preserve line breaks cleanly
  if (!sanitized.includes('<')) {
    return escapeHtmlText(sanitized).replace(/\r?\n/g, '<br />');
  }
  return sanitized;
}

/**
 * Strips all HTML tags and decodes common HTML entities to plain text
 * for vCard exports (.vcf) and card print placeholders.
 */
export function stripHtmlToPlainText(rawHtml?: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  return rawHtml
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
