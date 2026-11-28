import { compressDataUrlWithinBudget } from './qrArtwork';
import type { CardDesignRecord, CardSideDesign } from '../types';

export const FIRESTORE_MAX_DOC_BYTES = 1_048_576;
export const CARD_DESIGN_SAFE_MAX_BYTES = 860_000;
export const CARD_DESIGN_HARD_REJECT_BYTES = 980_000;

type MediaFieldName = 'backgroundImageUrl' | 'avatarDataUrl' | 'logoDataUrl';

interface MediaSlotSpec {
  sideKey: 'frontDesign' | 'backDesign';
  field: MediaFieldName;
  weight: number;
  maxWidth: number;
  maxHeight: number;
  preserveAlpha: boolean;
}

const MEDIA_SLOTS: MediaSlotSpec[] = [
  {
    sideKey: 'frontDesign',
    field: 'backgroundImageUrl',
    weight: 1.6,
    maxWidth: 1082,
    maxHeight: 1082,
    preserveAlpha: true,
  },
  {
    sideKey: 'backDesign',
    field: 'backgroundImageUrl',
    weight: 1.6,
    maxWidth: 1082,
    maxHeight: 1082,
    preserveAlpha: true,
  },
  {
    sideKey: 'frontDesign',
    field: 'avatarDataUrl',
    weight: 1.0,
    maxWidth: 420,
    maxHeight: 420,
    preserveAlpha: true,
  },
  {
    sideKey: 'backDesign',
    field: 'avatarDataUrl',
    weight: 1.0,
    maxWidth: 420,
    maxHeight: 420,
    preserveAlpha: true,
  },
  {
    sideKey: 'frontDesign',
    field: 'logoDataUrl',
    weight: 0.9,
    maxWidth: 480,
    maxHeight: 480,
    preserveAlpha: true,
  },
  {
    sideKey: 'backDesign',
    field: 'logoDataUrl',
    weight: 0.9,
    maxWidth: 480,
    maxHeight: 480,
    preserveAlpha: true,
  },
];

export type ImageDataUrlCompressor = (
  dataUrl: string,
  options: { maxWidth?: number; maxHeight?: number; maxChars: number; preserveAlpha?: boolean }
) => Promise<string>;

export function estimateJsonUtf8Bytes(value: unknown): number {
  const json = JSON.stringify(value) ?? '';
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(json, 'utf8');
  }
  return json.length;
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function cloneSide(side: CardSideDesign): CardSideDesign {
  return JSON.parse(JSON.stringify(side)) as CardSideDesign;
}

function isDataImageUrl(val: unknown): val is string {
  return typeof val === 'string' && val.startsWith('data:image/');
}

function stripHiddenUnusedAvatars<T extends { frontDesign: CardSideDesign; backDesign: CardSideDesign }>(
  design: T
): T {
  const next = {
    ...design,
    frontDesign: cloneSide(design.frontDesign),
    backDesign: cloneSide(design.backDesign),
  };
  if (!next.frontDesign.showAvatar && isDataImageUrl(next.frontDesign.avatarDataUrl)) {
    next.frontDesign.avatarDataUrl = '';
  }
  if (!next.backDesign.showAvatar && isDataImageUrl(next.backDesign.avatarDataUrl)) {
    next.backDesign.avatarDataUrl = '';
  }
  return next;
}

async function compressSlotsToBudget<T extends { frontDesign: CardSideDesign; backDesign: CardSideDesign }>(
  design: T,
  maxBytes: number,
  compressor: ImageDataUrlCompressor
): Promise<T> {
  const next: T = {
    ...design,
    frontDesign: cloneSide(design.frontDesign),
    backDesign: cloneSide(design.backDesign),
  };

  const activeSlots = MEDIA_SLOTS.filter((slot) => isDataImageUrl(next[slot.sideKey][slot.field]));
  if (activeSlots.length === 0) return next;

  // Measure non-media JSON payload size cleanly
  const blankProbe: T = {
    ...next,
    frontDesign: cloneSide(next.frontDesign),
    backDesign: cloneSide(next.backDesign),
  };
  for (const slot of activeSlots) {
    blankProbe[slot.sideKey][slot.field] = '';
  }
  const baseOverheadBytes = estimateJsonUtf8Bytes(blankProbe);
  const totalMediaBudget = Math.max(24_000, maxBytes - baseOverheadBytes);

  // Allocate budget proportionally across slots, preserving smaller slots that already fit
  const allocations = new Map<MediaSlotSpec, number>();
  const lockedSlots = new Set<MediaSlotSpec>();
  let remainingBudget = totalMediaBudget;

  while (lockedSlots.size < activeSlots.length) {
    const unlocked = activeSlots.filter((s) => !lockedSlots.has(s));
    const totalWeight = unlocked.reduce((sum, s) => sum + s.weight, 0) || 1;
    let lockedAnyInPass = false;

    for (const slot of unlocked) {
      const currentVal = String(next[slot.sideKey][slot.field] || '');
      const weightedShare = Math.floor((remainingBudget * slot.weight) / totalWeight);
      if (currentVal.length <= weightedShare) {
        allocations.set(slot, currentVal.length);
        lockedSlots.add(slot);
        remainingBudget = Math.max(4_000, remainingBudget - currentVal.length);
        lockedAnyInPass = true;
      }
    }

    if (!lockedAnyInPass) {
      for (const slot of unlocked) {
        const weightedShare = Math.max(
          8_000,
          Math.floor((remainingBudget * slot.weight) / totalWeight)
        );
        allocations.set(slot, weightedShare);
        lockedSlots.add(slot);
      }
    }
  }

  // Deduplicate compression work for identical data URLs at identical/smaller budgets
  const cache = new Map<string, Promise<string>>();
  await Promise.all(
    activeSlots.map(async (slot) => {
      const currentVal = String(next[slot.sideKey][slot.field] || '');
      const targetChars = Math.max(8_000, allocations.get(slot) ?? 120_000);
      if (currentVal.length <= targetChars) return;

      const cacheKey = `${currentVal.length}:${currentVal.slice(0, 48)}:${currentVal.slice(-24)}:${targetChars}:${slot.maxWidth}:${slot.maxHeight}`;
      let pending = cache.get(cacheKey);
      if (!pending) {
        pending = compressor(currentVal, {
          maxWidth: slot.maxWidth,
          maxHeight: slot.maxHeight,
          maxChars: targetChars,
          preserveAlpha: slot.preserveAlpha,
        });
        cache.set(cacheKey, pending);
      }
      const compressed = await pending;
      next[slot.sideKey][slot.field] = compressed;
    })
  );

  return next;
}

export async function prepareCardDesignForFirestore<
  T extends Pick<CardDesignRecord, 'frontDesign' | 'backDesign'>
>(
  design: T,
  options?: {
    safeMaxBytes?: number;
    hardMaxBytes?: number;
    compressor?: ImageDataUrlCompressor;
  }
): Promise<T> {
  const safeMaxBytes = options?.safeMaxBytes ?? CARD_DESIGN_SAFE_MAX_BYTES;
  const hardMaxBytes = options?.hardMaxBytes ?? CARD_DESIGN_HARD_REJECT_BYTES;
  const compressor = options?.compressor ?? compressDataUrlWithinBudget;

  let current = stripUndefinedDeep({
    ...design,
    frontDesign: cloneSide(design.frontDesign),
    backDesign: cloneSide(design.backDesign),
  });

  if (estimateJsonUtf8Bytes(current) <= safeMaxBytes) {
    return current;
  }

  // Step 1: Drop hidden unused avatarDataUrl copies (e.g. backDesign when showAvatar is false)
  current = stripHiddenUnusedAvatars(current);
  if (estimateJsonUtf8Bytes(current) <= safeMaxBytes) {
    return current;
  }

  // Step 2: Compress oversized data URLs proportionally within safe budget
  current = await compressSlotsToBudget(current, safeMaxBytes, compressor);
  if (estimateJsonUtf8Bytes(current) <= safeMaxBytes) {
    return current;
  }

  // Step 3: Second tightening pass with 75% target headroom
  current = await compressSlotsToBudget(current, Math.floor(safeMaxBytes * 0.75), compressor);

  const finalBytes = estimateJsonUtf8Bytes(current);
  if (finalBytes > hardMaxBytes) {
    throw new Error(
      'Your card design images are too large to save within the 1 MB limit. Please replace or remove one of the custom images and try again.'
    );
  }

  return current;
}

export function formatFirestoreErrorMessage(err: unknown, fallback = 'Save failed. Please try again.'): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return fallback;
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        if (parsed.error.includes('exceeds the maximum allowed size')) {
          return 'Your card design images exceed the 1 MB storage limit. Please use smaller images or remove unused background/logo images and try again.';
        }
        return parsed.error;
      }
    } catch {
      // fall through to raw message
    }
  }
  return raw;
}
