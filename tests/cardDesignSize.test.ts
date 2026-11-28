import { describe, expect, it, vi } from 'vitest';
import {
  CARD_DESIGN_SAFE_MAX_BYTES,
  estimateJsonUtf8Bytes,
  FIRESTORE_MAX_DOC_BYTES,
  formatFirestoreErrorMessage,
  prepareCardDesignForFirestore,
} from '../src/lib/cardDesignSize';
import {
  populateSideWithProfileInfo,
  refreshUneditedSideWithProfileInfo,
} from '../src/lib/cardProfileSync';
import { createBlankSideDesign } from '../src/lib/constants';
import type { CardDesignRecord } from '../src/types';

function makeFakeDataUrl(prefix: string, totalChars: number): string {
  const header = `data:image/png;base64,${prefix}`;
  if (header.length >= totalChars) return header.slice(0, totalChars);
  return header + 'A'.repeat(totalChars - header.length);
}

function makeBaseDesign(): Omit<CardDesignRecord, 'createdAt' | 'updatedAt'> {
  return {
    designId: 'des_test_123',
    uid: 'user_123',
    profileId: 'prof_123',
    templateId: 'tpl_1',
    cardTechnology: 'qr_smart',
    frontDesign: {
      ...createBlankSideDesign('front'),
      showAvatar: true,
    },
    backDesign: {
      ...createBlankSideDesign('back'),
      showAvatar: false,
    },
    cardOrientation: 'landscape',
    dimensions: '85.6x54mm',
    bleed: '3mm',
    approved: true,
    locked: false,
    version: 1,
  };
}

describe('cardDesignSize Firestore 1 MiB safeguard', () => {
  it('leaves compact designs untouched', async () => {
    const design = makeBaseDesign();
    design.frontDesign.backgroundImageUrl = '/assets/aistudio/sample.webp';
    design.frontDesign.avatarDataUrl = makeFakeDataUrl('AV', 45_000);

    const compressor = vi.fn(async (val: string) => val);
    const prepared = await prepareCardDesignForFirestore(design, { compressor });

    expect(compressor).not.toHaveBeenCalled();
    expect(prepared.frontDesign.avatarDataUrl).toBe(design.frontDesign.avatarDataUrl);
    expect(estimateJsonUtf8Bytes(prepared)).toBeLessThan(CARD_DESIGN_SAFE_MAX_BYTES);
  });

  it('drops hidden unused back avatar duplicates before compressing active artwork', async () => {
    const design = makeBaseDesign();
    const sharedPhoto = makeFakeDataUrl('PH', 450_000);
    design.frontDesign.showAvatar = true;
    design.frontDesign.avatarDataUrl = sharedPhoto;
    design.backDesign.showAvatar = false;
    design.backDesign.avatarDataUrl = sharedPhoto;

    const compressor = vi.fn(async (val: string) => val);
    const prepared = await prepareCardDesignForFirestore(design, { compressor });

    expect(compressor).not.toHaveBeenCalled();
    expect(prepared.frontDesign.avatarDataUrl).toBe(sharedPhoto);
    expect(prepared.backDesign.avatarDataUrl).toBe('');
    expect(estimateJsonUtf8Bytes(prepared)).toBeLessThan(CARD_DESIGN_SAFE_MAX_BYTES);
  });

  it('compresses multi-image 1.28 MB payloads well below Firestore 1 MiB limit and deduplicates shared images', async () => {
    const design = makeBaseDesign();
    design.frontDesign.backgroundImageUrl = makeFakeDataUrl('FBG', 340_000);
    design.backDesign.backgroundImageUrl = makeFakeDataUrl('BBG', 340_000);
    design.frontDesign.avatarDataUrl = makeFakeDataUrl('FAV', 340_000);
    design.frontDesign.logoDataUrl = makeFakeDataUrl('FLG', 160_000);
    design.backDesign.logoDataUrl = design.frontDesign.logoDataUrl;

    expect(estimateJsonUtf8Bytes(design)).toBeGreaterThan(1_250_000);

    const compressor = vi.fn(async (_dataUrl: string, opts: { maxChars: number }) =>
      makeFakeDataUrl('CMP', Math.min(_dataUrl.length, opts.maxChars))
    );

    const prepared = await prepareCardDesignForFirestore(design, { compressor });
    const finalBytes = estimateJsonUtf8Bytes(prepared);

    expect(finalBytes).toBeLessThanOrEqual(CARD_DESIGN_SAFE_MAX_BYTES);
    expect(finalBytes).toBeLessThan(FIRESTORE_MAX_DOC_BYTES);
    expect(prepared.frontDesign.backgroundImageUrl?.startsWith('data:image/')).toBe(true);
    expect(prepared.backDesign.backgroundImageUrl?.startsWith('data:image/')).toBe(true);
    expect(prepared.frontDesign.avatarDataUrl?.startsWith('data:image/')).toBe(true);
    // Identical front/back logos reuse the same cached compression result
    expect(prepared.frontDesign.logoDataUrl).toBe(prepared.backDesign.logoDataUrl);
    expect(compressor.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('throws a clean user-facing error if images still exceed the hard limit', async () => {
    const design = makeBaseDesign();
    design.frontDesign.backgroundImageUrl = makeFakeDataUrl('HUGE', 1_100_000);

    const nonShrinkingCompressor = vi.fn(async (val: string) => val);
    await expect(
      prepareCardDesignForFirestore(design, { compressor: nonShrinkingCompressor })
    ).rejects.toThrow(/1 MB limit/i);
  });

  it('does not copy profile photoDataUrl onto hidden card sides during hydration', () => {
    const photo = makeFakeDataUrl('P', 120_000);
    const backTemplate = { ...createBlankSideDesign('back'), showAvatar: false };
    const frontTemplate = { ...createBlankSideDesign('front'), showAvatar: true };

    const populatedBack = populateSideWithProfileInfo(backTemplate, {
      fullName: 'Test User',
      photoDataUrl: photo,
    });
    const populatedFront = populateSideWithProfileInfo(frontTemplate, {
      fullName: 'Test User',
      photoDataUrl: photo,
    });

    expect(populatedBack.avatarDataUrl).toBeUndefined();
    expect(populatedFront.avatarDataUrl).toBe(photo);

    // Also cleans redundant duplicate left on an older draft when showAvatar is false
    const legacyDraftBack = { ...backTemplate, avatarDataUrl: photo };
    const refreshedBack = refreshUneditedSideWithProfileInfo(legacyDraftBack, {
      fullName: 'Test User',
      photoDataUrl: photo,
    });
    expect(refreshedBack.avatarDataUrl).toBeUndefined();
  });

  it('unwraps Firestore JSON error envelopes without leaking authInfo', () => {
    const rawErr = new Error(
      JSON.stringify({
        error:
          "Document 'projects/x/databases/y/documents/cardDesigns/des_1' cannot be written because its size (1,282,222 bytes) exceeds the maximum allowed size of 1,048,576 bytes.",
        authInfo: { userId: 'secret_uid', email: 'user@example.com' },
      })
    );

    const formatted = formatFirestoreErrorMessage(rawErr);
    expect(formatted).not.toContain('authInfo');
    expect(formatted).not.toContain('user@example.com');
    expect(formatted).toContain('1 MB');
  });
});
