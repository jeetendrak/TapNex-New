import type { CardDesignRecord, CardSideDesign, CardTechnologyType } from '../types';

export interface ActiveStudioDraft {
  profileId: string;
  templateId: string;
  templateName: string;
  cardTechnology?: CardTechnologyType;
  cardOrientation: 'landscape' | 'vertical';
  frontDesign: CardSideDesign;
  backDesign: CardSideDesign;
  updatedMs: number;
}

function draftKey(uid: string, profileId: string): string {
  return `tapnex_studio_draft_${uid}_${profileId}`;
}

export function saveActiveStudioDraft(
  uid: string,
  profileId: string,
  draft: Omit<ActiveStudioDraft, 'profileId' | 'updatedMs'> & { updatedMs?: number }
): void {
  if (typeof window === 'undefined' || !uid || !profileId) return;
  try {
    const payload: ActiveStudioDraft = {
      ...draft,
      profileId,
      updatedMs: draft.updatedMs ?? Date.now(),
    };
    window.localStorage.setItem(draftKey(uid, profileId), JSON.stringify(payload));
  } catch {
    // Ignore localStorage quota errors cleanly (Firestore Save Draft remains primary persistence)
  }
}

export function getActiveStudioDraft(uid: string, profileId?: string | null): ActiveStudioDraft | null {
  if (typeof window === 'undefined' || !uid || !profileId) return null;
  try {
    const raw = window.localStorage.getItem(draftKey(uid, profileId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveStudioDraft;
    if (!parsed || !parsed.frontDesign || !parsed.backDesign) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearAllLocalStudioDrafts(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith('tapnex_studio_draft_') || key.startsWith('tapnex_'))) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
    return keysToRemove.length;
  } catch {
    return 0;
  }
}

export function resolveEffectiveCardDesign(params: {
  savedDesign: CardDesignRecord | null;
  savedTimestampMs: number;
  localDraft: ActiveStudioDraft | null;
  uid: string;
  profileId: string;
}): CardDesignRecord | null {
  const { savedDesign, savedTimestampMs, localDraft, uid, profileId } = params;
  if (localDraft && (!savedDesign || localDraft.updatedMs >= savedTimestampMs)) {
    return {
      designId: savedDesign?.designId || `studio_draft_${profileId}`,
      uid,
      profileId,
      templateId: localDraft.templateId,
      frontDesign: localDraft.frontDesign,
      backDesign: localDraft.backDesign,
      cardOrientation: localDraft.cardOrientation,
      dimensions: localDraft.cardOrientation === 'vertical' ? '54x85.6mm' : '85.6x54mm',
      bleed: '3mm',
      approved: false,
      locked: false,
      version: savedDesign?.version || 1,
      createdAt: savedDesign?.createdAt || '',
      updatedAt: new Date(localDraft.updatedMs).toISOString(),
    };
  }
  return savedDesign;
}
