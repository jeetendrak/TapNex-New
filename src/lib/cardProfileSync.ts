import { resolveCardTokens } from './printPdf';
import type {
  CardSideDesign,
  CardTemplateRecord,
  CardTextElement,
  PersonalInformation,
  ProfileRecord,
  ProfileType,
  UserRecord,
} from '../types';

const TOKEN_TO_FIELD_KEY: Record<string, string> = {
  '{{FULL_NAME}}': 'fullName',
  '{{JOB_TITLE}}': 'jobTitle',
  '{{COMPANY}}': 'companyName',
  '{{BUSINESS_CATEGORY}}': 'businessCategory',
  '{{SHORT_BIO}}': 'shortBio',
  '{{MOBILE}}': 'mobile',
  '{{ALTERNATE_MOBILE}}': 'alternateMobile',
  '{{WHATSAPP}}': 'whatsapp',
  '{{EMAIL}}': 'email',
  '{{ALTERNATE_EMAIL}}': 'alternateEmail',
  '{{WEBSITE}}': 'website',
  '{{CITY_STATE}}': 'cityState',
  '{{ADDRESS}}': 'businessAddress',
  '{{PERSONAL_ADDRESS}}': 'personalAddress',
  '{{BLOOD_GROUP}}': 'bloodGroup',
  '{{EMERGENCY_NAME}}': 'emergencyContactName',
  '{{EMERGENCY_RELATION}}': 'emergencyContactRelation',
  '{{EMERGENCY_PHONE}}': 'emergencyContactPhone',
  '{{DOB}}': 'dateOfBirth',
  '{{PARENT_NAME}}': 'parentName',
  '{{PARENT_MOBILE}}': 'parentMobile',
  '{{SCHOOL_CLASS}}': 'schoolOrClass',
  '{{ALLERGIES}}': 'allergiesOrMedical',
  '{{SPECIAL_NOTES}}': 'specialNotes',
  '{{PET_TYPE}}': 'petType',
  '{{BREED}}': 'breed',
  '{{PET_GENDER}}': 'petGender',
  '{{PET_COLOR}}': 'petColor',
  '{{MICROCHIP_ID}}': 'microchipId',
  '{{OWNER_NAME}}': 'ownerName',
  '{{OWNER_MOBILE}}': 'ownerMobile',
  '{{VET_NAME}}': 'vetName',
  '{{VET_PHONE}}': 'vetPhone',
  '{{ITEM_CATEGORY}}': 'itemCategory',
  '{{BRAND_MODEL}}': 'brandModel',
  '{{SERIAL_NUMBER}}': 'serialNumber',
  '{{FINDER_NOTES}}': 'finderNotes',
};

const TOKEN_REGEX = /\{\{[A-Z0-9_]+\}\}/g;

/**
 * Combines stored profile personalInformation with account-level UserRecord fallbacks
 * so templates always start populated with the user's known details.
 */
export function buildEffectiveProfileInfo(
  profile?: Partial<ProfileRecord> | null,
  userRecord?: Pick<UserRecord, 'displayName' | 'email' | 'phone'> | null
): Partial<PersonalInformation> {
  const pi: Partial<PersonalInformation> = profile?.personalInformation || {};
  const pType = profile?.profileType || 'adult';
  const fallbackName = pi.fullName?.trim() || (pType === 'adult' ? userRecord?.displayName?.trim() || '' : '');
  const fallbackEmail = pi.email?.trim() || userRecord?.email?.trim() || '';
  const fallbackMobile = pi.mobile?.trim() || userRecord?.phone?.trim() || '';

  return {
    ...pi,
    ...(fallbackName ? { fullName: fallbackName } : {}),
    ...(fallbackEmail ? { email: fallbackEmail } : {}),
    ...(fallbackMobile ? { mobile: fallbackMobile } : {}),
    ...(pType === 'kids' && !pi.parentName?.trim() && userRecord?.displayName?.trim()
      ? { parentName: userRecord.displayName.trim() }
      : {}),
    ...(pType === 'kids' && !pi.parentMobile?.trim() && fallbackMobile
      ? { parentMobile: fallbackMobile }
      : {}),
    ...(pType === 'pets' && !pi.ownerName?.trim() && userRecord?.displayName?.trim()
      ? { ownerName: userRecord.displayName.trim() }
      : {}),
    ...(pType === 'pets' && !pi.ownerMobile?.trim() && fallbackMobile
      ? { ownerMobile: fallbackMobile }
      : {}),
  };
}

export function detectAllFieldKeysFromText(text: string): string[] {
  const matches = (text || '').match(TOKEN_REGEX) || [];
  const keys: string[] = [];
  for (const m of matches) {
    const k = TOKEN_TO_FIELD_KEY[m];
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

export function detectFieldKeyFromText(text: string): string | undefined {
  return detectAllFieldKeysFromText(text)[0];
}

export function hasRealProfileValueForToken(
  token: string,
  info: Partial<PersonalInformation>
): boolean {
  const trim = (v?: string) => (v || '').trim();
  switch (token) {
    case '{{FULL_NAME}}':
      return Boolean(trim(info.fullName));
    case '{{JOB_TITLE}}':
      return Boolean(trim(info.jobTitle));
    case '{{COMPANY}}':
      return Boolean(trim(info.companyName));
    case '{{BUSINESS_CATEGORY}}':
      return Boolean(trim(info.businessCategory));
    case '{{SHORT_BIO}}':
      return Boolean(trim(info.shortBio));
    case '{{MOBILE}}':
      return Boolean(trim(info.mobile) || trim(info.parentMobile) || trim(info.ownerMobile));
    case '{{ALTERNATE_MOBILE}}':
      return Boolean(trim(info.alternateMobile));
    case '{{WHATSAPP}}':
      return Boolean(trim(info.whatsapp) || trim(info.mobile) || trim(info.ownerMobile));
    case '{{EMAIL}}':
      return Boolean(trim(info.email));
    case '{{ALTERNATE_EMAIL}}':
      return Boolean(trim(info.alternateEmail));
    case '{{WEBSITE}}':
      return Boolean(trim(info.website));
    case '{{CITY_STATE}}':
      return Boolean(trim(info.city) || trim(info.state));
    case '{{ADDRESS}}':
      return Boolean(
        trim(info.businessAddress) ||
          trim(info.personalAddress) ||
          trim(info.city) ||
          trim(info.state) ||
          trim(info.pinCode)
      );
    case '{{PERSONAL_ADDRESS}}':
      return Boolean(
        trim(info.personalAddress) ||
          trim(info.businessAddress) ||
          trim(info.city) ||
          trim(info.state) ||
          trim(info.pinCode)
      );
    case '{{BLOOD_GROUP}}':
      return Boolean(trim(info.bloodGroup));
    case '{{EMERGENCY_NAME}}':
      return Boolean(trim(info.emergencyContactName) || trim(info.parentName) || trim(info.ownerName));
    case '{{EMERGENCY_RELATION}}':
      return Boolean(trim(info.emergencyContactRelation));
    case '{{EMERGENCY_PHONE}}':
      return Boolean(
        trim(info.emergencyContactPhone) ||
          trim(info.parentMobile) ||
          trim(info.ownerMobile) ||
          trim(info.mobile)
      );
    case '{{DOB}}':
      return Boolean(trim(info.dateOfBirth));
    case '{{PARENT_NAME}}':
      return Boolean(trim(info.parentName) || trim(info.emergencyContactName));
    case '{{PARENT_MOBILE}}':
      return Boolean(trim(info.parentMobile) || trim(info.emergencyContactPhone) || trim(info.mobile));
    case '{{SCHOOL_CLASS}}':
      return Boolean(trim(info.schoolOrClass));
    case '{{ALLERGIES}}':
      return Boolean(trim(info.allergiesOrMedical));
    case '{{SPECIAL_NOTES}}':
      return Boolean(trim(info.specialNotes));
    case '{{PET_TYPE}}':
      return Boolean(trim(info.petType));
    case '{{BREED}}':
      return Boolean(trim(info.breed));
    case '{{PET_GENDER}}':
      return Boolean(trim(info.petGender));
    case '{{PET_COLOR}}':
      return Boolean(trim(info.petColor));
    case '{{MICROCHIP_ID}}':
      return Boolean(trim(info.microchipId));
    case '{{OWNER_NAME}}':
      return Boolean(trim(info.ownerName));
    case '{{OWNER_MOBILE}}':
      return Boolean(trim(info.ownerMobile) || trim(info.mobile));
    case '{{VET_NAME}}':
      return Boolean(trim(info.vetName));
    case '{{VET_PHONE}}':
      return Boolean(trim(info.vetPhone));
    case '{{ITEM_CATEGORY}}':
      return Boolean(
        info.itemCategory === 'Other' ? trim(info.itemCategoryOther) || 'Other' : trim(info.itemCategory)
      );
    case '{{BRAND_MODEL}}':
      return Boolean(trim(info.brandModel));
    case '{{SERIAL_NUMBER}}':
      return Boolean(trim(info.serialNumber));
    case '{{FINDER_NOTES}}':
      return Boolean(trim(info.finderNotes));
    default:
      return false;
  }
}

export function isTokenResolvedToRealValue(
  text: string,
  info: Partial<PersonalInformation>
): boolean {
  const tokens = (text || '').match(TOKEN_REGEX);
  if (!tokens || tokens.length === 0) return false;
  return tokens.every((tk) => hasRealProfileValueForToken(tk, info));
}

function resolvePartialTokens(
  sourceText: string,
  info: Partial<PersonalInformation>
): { resolved: string; hadResolvableTokens: boolean } {
  const tokens = (sourceText || '').match(TOKEN_REGEX);
  if (!tokens || tokens.length === 0) {
    return { resolved: sourceText, hadResolvableTokens: false };
  }
  let nextText = sourceText;
  let anyResolved = false;
  for (const tk of new Set(tokens)) {
    if (hasRealProfileValueForToken(tk, info)) {
      const resolvedSingle = resolveCardTokens(tk, info);
      nextText = nextText.split(tk).join(resolvedSingle);
      anyResolved = true;
    }
  }
  return { resolved: nextText, hadResolvableTokens: anyResolved };
}

function materializeElementWithProfile(
  el: CardTextElement,
  info: Partial<PersonalInformation>
): CardTextElement {
  const tokenExpr = el.sourceTokenText || el.text;
  const detectedKeys = detectAllFieldKeysFromText(tokenExpr);
  const mergedKeys = Array.from(
    new Set([
      ...(el.fieldKey ? [el.fieldKey] : []),
      ...(el.fieldKeys || []),
      ...detectedKeys,
    ])
  );
  const primaryKey = el.fieldKey || mergedKeys[0];
  const rawTokens = (el.text || '').match(TOKEN_REGEX);

  // Case 1: Element currently still holds {{TOKEN}} placeholders directly
  if (rawTokens && rawTokens.length > 0) {
    const { resolved } = resolvePartialTokens(el.text, info);
    return {
      ...el,
      text: resolved,
      sourceTokenText: el.sourceTokenText || el.text,
      lastSyncedText: resolved,
      ...(primaryKey ? { fieldKey: primaryKey } : {}),
      ...(mergedKeys.length > 1 ? { fieldKeys: mergedKeys } : {}),
    };
  }

  // Case 2: Element was auto-filled earlier and NOT manually customized by user — re-sync if profile info changed (e.g. Dog Name -> Pluto)
  if (
    el.sourceTokenText &&
    el.lastSyncedText !== undefined &&
    el.text === el.lastSyncedText
  ) {
    const { resolved } = resolvePartialTokens(el.sourceTokenText, info);
    return {
      ...el,
      text: resolved,
      lastSyncedText: resolved,
      ...(primaryKey ? { fieldKey: primaryKey } : {}),
      ...(mergedKeys.length > 1 ? { fieldKeys: mergedKeys } : {}),
    };
  }

  return {
    ...el,
    ...(primaryKey && !el.fieldKey ? { fieldKey: primaryKey } : {}),
    ...(mergedKeys.length > 1 ? { fieldKeys: mergedKeys } : {}),
  };
}

/**
 * Clones a template or default card side and immediately materializes the user's
 * filled profile values directly into text elements while tagging `fieldKey` + `sourceTokenText`
 * so elements remain directly editable AND automatically re-sync when profile fields change unless manually edited.
 */
export function populateSideWithProfileInfo(
  side: CardSideDesign,
  info: Partial<PersonalInformation>
): CardSideDesign {
  const cloned = JSON.parse(JSON.stringify(side)) as CardSideDesign;
  const resolvedAvatarUrl = cloned.showAvatar
    ? cloned.avatarDataUrl || info.photoDataUrl || ''
    : cloned.avatarDataUrl || '';
  return {
    ...cloned,
    ...(resolvedAvatarUrl ? { avatarDataUrl: resolvedAvatarUrl } : {}),
    avatarSizeMm: cloned.avatarSizeMm || 15,
    elements: (cloned.elements || []).map((el) => materializeElementWithProfile(el, info)),
  };
}

/**
 * Safely refreshes an already-loaded draft or saved design so any element that still contains
 * unresolved {{TOKEN}} placeholders or matches its last auto-synced snapshot picks up updated profile data
 * without touching manual custom user edits.
 */
export function refreshUneditedSideWithProfileInfo(
  side: CardSideDesign,
  info: Partial<PersonalInformation>
): CardSideDesign {
  const cloned = JSON.parse(JSON.stringify(side)) as CardSideDesign;
  const isRedundantProfilePhoto =
    !cloned.showAvatar && Boolean(info.photoDataUrl) && cloned.avatarDataUrl === info.photoDataUrl;
  const resolvedAvatarUrl = cloned.showAvatar
    ? cloned.avatarDataUrl || info.photoDataUrl || ''
    : isRedundantProfilePhoto
    ? ''
    : cloned.avatarDataUrl || '';
  const { avatarDataUrl: _ignoredAvatar, ...restCloned } = cloned;
  return {
    ...restCloned,
    ...(resolvedAvatarUrl ? { avatarDataUrl: resolvedAvatarUrl } : {}),
    elements: (cloned.elements || []).map((el) => materializeElementWithProfile(el, info)),
  };
}

/**
 * Automatically selects the best matching card/tag template for a user's profile:
 * - Dog profile (`pets` with `petType === 'Dog'`) -> Dog Tag template (`pet-dog-tag-classic`)
 * - Helmet / Bike belonging (`belongings` with Helmet/Bike) -> Round Helmet Sticker (`belongings-helmet-sticker-round`)
 * - Kids / Pets / Belongings -> matching profileType template
 * - Adult -> admin-selected default template
 */
export function selectDefaultTemplateForProfile(
  profile: Partial<ProfileRecord> | null | undefined,
  templates: CardTemplateRecord[]
): CardTemplateRecord | undefined {
  if (!templates || templates.length === 0) return undefined;
  const activeProfileType: ProfileType = profile?.profileType || 'adult';
  const pi = profile?.personalInformation;

  if (activeProfileType === 'pets') {
    const petSignal = `${pi?.petType || ''} ${profile?.profileLabel || ''} ${pi?.fullName || ''}`.toLowerCase();
    if (!pi?.petType || petSignal.includes('dog') || petSignal.includes('puppy')) {
      const dogTpl =
        templates.find((t) => t.templateId === 'pet-dog-tag-classic') ||
        templates.find((t) => (t.tagKeywords || []).some((k) => k.toLowerCase() === 'dog'));
      if (dogTpl) return dogTpl;
    }
    return (
      templates.find((t) => t.profileType === 'pets' && t.isDefault) ||
      templates.find((t) => t.profileType === 'pets') ||
      templates.find((t) => t.isDefault) ||
      templates[0]
    );
  }

  if (activeProfileType === 'belongings') {
    const itemSignal = `${pi?.itemCategory || ''} ${pi?.itemCategoryOther || ''} ${profile?.profileLabel || ''} ${pi?.fullName || ''}`.toLowerCase();
    if (itemSignal.includes('helmet') || itemSignal.includes('bike') || itemSignal.includes('motorcycle')) {
      const helmetTpl =
        templates.find((t) => t.templateId === 'belongings-helmet-sticker-round') ||
        templates.find((t) => (t.tagKeywords || []).some((k) => k.toLowerCase() === 'helmet'));
      if (helmetTpl) return helmetTpl;
    }
    return (
      templates.find((t) => t.profileType === 'belongings' && t.isDefault) ||
      templates.find((t) => t.profileType === 'belongings') ||
      templates.find((t) => t.isDefault) ||
      templates[0]
    );
  }

  if (activeProfileType === 'kids') {
    return (
      templates.find((t) => t.profileType === 'kids' && t.isDefault) ||
      templates.find((t) => t.profileType === 'kids') ||
      templates.find((t) => t.isDefault) ||
      templates[0]
    );
  }

  return templates.find((t) => t.isDefault) || templates[0];
}

export function doesSideContainField(
  side: CardSideDesign,
  opt: { key: string; insertText: string }
): boolean {
  const insert = opt.insertText.trim();
  const isTokenInsert = /^\{\{[A-Z0-9_]+\}\}$/.test(insert);
  return (side.elements || []).some((el) => {
    if (el.fieldKey && el.fieldKey === opt.key) return true;
    if (el.fieldKeys && el.fieldKeys.includes(opt.key)) return true;
    const textTrimmed = (el.text || '').trim();
    if (!textTrimmed || !insert) return false;
    if (textTrimmed === insert) return true;
    if (isTokenInsert && textTrimmed.includes(insert)) return true;
    const detectedKeys = detectAllFieldKeysFromText(textTrimmed);
    return detectedKeys.includes(opt.key);
  });
}

export function getNextCleanCardTextSlot(side: CardSideDesign): {
  xPct: number;
  yPct: number;
  maxWidthPct: number;
} {
  const elements = side.elements || [];
  const hasRightQr = Boolean(side.showQrSlot && (side.qrSlotX ?? 68) >= 48);
  const hasLeftQr = Boolean(side.showQrSlot && (side.qrSlotX ?? 68) < 42);
  const hasLeftAvatar = Boolean(side.showAvatar && (side.avatarX ?? 8) < 38);

  const primaryX = hasLeftAvatar
    ? Math.max(8, Math.min(44, (side.avatarX ?? 8) + 26))
    : hasLeftQr
      ? Math.max(8, Math.min(44, (side.qrSlotX ?? 8) + 26))
      : 8;
  const primaryMaxW = hasRightQr
    ? Math.max(36, Math.min(82, (side.qrSlotX ?? 68) - primaryX - 4))
    : Math.max(40, Math.min(84, 92 - primaryX));

  const candidateRows = [12, 21, 30, 39, 48, 57, 66, 75, 84];
  for (const y of candidateRows) {
    const occupied = elements.some(
      (el) => Math.abs((el.yPct ?? 0) - y) < 7.5 && Math.abs((el.xPct ?? 0) - primaryX) < 35
    );
    if (!occupied) {
      return { xPct: Number(primaryX.toFixed(1)), yPct: y, maxWidthPct: Number(primaryMaxW.toFixed(0)) };
    }
  }

  // Secondary column (e.g. right side if not covered by QR)
  const secondaryX = hasRightQr ? 8 : 52;
  const secondaryMaxW = hasRightQr ? Math.max(36, (side.qrSlotX ?? 68) - 12) : 40;
  for (const y of candidateRows) {
    const overlapsQr =
      side.showQrSlot &&
      secondaryX + secondaryMaxW > (side.qrSlotX ?? 68) - 3 &&
      secondaryX < (side.qrSlotX ?? 68) + 24 &&
      y > (side.qrSlotY ?? 22) - 6 &&
      y < (side.qrSlotY ?? 22) + 34;
    if (overlapsQr) continue;
    const occupied = elements.some(
      (el) => Math.abs((el.yPct ?? 0) - y) < 7.5 && Math.abs((el.xPct ?? 0) - secondaryX) < 25
    );
    if (!occupied) {
      return { xPct: secondaryX, yPct: y, maxWidthPct: secondaryMaxW };
    }
  }

  const offset = (elements.length % 5) * 6;
  return {
    xPct: 10 + (elements.length % 3) * 4,
    yPct: Math.min(84, 20 + offset),
    maxWidthPct: Math.max(42, primaryMaxW),
  };
}
