import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_CARD_TEMPLATES,
  DEFAULT_EMAIL_TEMPLATES,
  DEFAULT_PAYMENT_GATEWAYS,
  DEFAULT_SHOP_CATEGORIES,
  DEFAULT_SHOP_PRODUCTS,
  DEFAULT_VISIBILITY,
  EMPTY_PERSONAL_INFO,
  PAYMENT_GATEWAY_ORDER,
} from './constants';
import { sanitizeRichBioHtml } from './richText';
import { clearAllLocalStudioDrafts } from './studioDraft';
import { prepareCardDesignForFirestore } from './cardDesignSize';
import { compressDataUrlWithinBudget } from './qrArtwork';
import type {
  AppSettingsRecord,
  AuditLogRecord,
  CardDesignRecord,
  CardTemplateRecord,
  CustomFieldItem,
  EmailTemplateRecord,
  NotificationRecord,
  OrderRecord,
  OrderShopItem,
  OrderStatus,
  PaymentGatewayConfig,
  PaymentGatewayId,
  PaymentRecord,
  PaymentStatus,
  PersonalInformation,
  PrinterRecord,
  ProfileRecord,
  ProfileType,
  PublicProfileRecord,
  QrCodeRecord,
  ShippingAddress,
  ShippingRecord,
  ShopCategoryRecord,
  ShopProductRecord,
  SocialLinkItem,
  SupportTicketRecord,
  UserRecord,
  UserRole,
  UserStatus,
  VisibilitySettings,
} from '../types';

export function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function generateAutoProfileSlug(seedName?: string): string {
  const base = sanitizeSlug(seedName || '').slice(0, 36).replace(/-+$/, '');
  const randomSuffix = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 5) || '1042x';
  if (base.length >= 3) {
    return sanitizeSlug(`${base}-${randomSuffix}`);
  }
  return `tpnx-${randomSuffix}${Date.now().toString(36).slice(-3)}`;
}

export type ReusableProfileFieldKey =
  | 'address'
  | 'emergencyContact'
  | 'parentContact'
  | 'ownerContact'
  | 'mobile'
  | 'alternateMobile'
  | 'email'
  | 'website';

export function copyProfileFieldsBySelection(
  source: Partial<PersonalInformation> | undefined | null,
  selection: Partial<Record<ReusableProfileFieldKey, boolean>>
): Partial<PersonalInformation> {
  if (!source) return {};
  const copied: Partial<PersonalInformation> = {};
  if (selection.address) {
    if (source.businessAddress) copied.businessAddress = source.businessAddress;
    if (source.personalAddress) copied.personalAddress = source.personalAddress;
    if (source.city) copied.city = source.city;
    if (source.state) copied.state = source.state;
    if (source.pinCode) copied.pinCode = source.pinCode;
    if (source.country) copied.country = source.country;
  }
  if (selection.emergencyContact) {
    if (source.emergencyContactName) copied.emergencyContactName = source.emergencyContactName;
    if (source.emergencyContactRelation) copied.emergencyContactRelation = source.emergencyContactRelation;
    if (source.emergencyContactPhone) copied.emergencyContactPhone = source.emergencyContactPhone;
  }
  if (selection.parentContact) {
    copied.parentName = source.parentName || source.fullName || '';
    copied.parentMobile = source.parentMobile || source.mobile || '';
  }
  if (selection.ownerContact) {
    copied.ownerName = source.ownerName || source.fullName || '';
    copied.ownerMobile = source.ownerMobile || source.mobile || '';
  }
  if (selection.mobile && source.mobile) {
    copied.mobile = source.mobile;
    if (source.whatsapp) copied.whatsapp = source.whatsapp;
  }
  if (selection.alternateMobile && source.alternateMobile) {
    copied.alternateMobile = source.alternateMobile;
  }
  if (selection.email && source.email) {
    copied.email = source.email;
  }
  if (selection.website && source.website) {
    copied.website = source.website;
  }
  return copied;
}

export function extractTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val === 'string') {
    const ms = Date.parse(val);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'object') {
    const obj = val as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof obj.toMillis === 'function') {
      const ms = obj.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    const secs = obj.seconds ?? obj._seconds;
    if (typeof secs === 'number' && Number.isFinite(secs)) {
      return secs * 1000;
    }
  }
  return 0;
}

export function formatTimestampDate(val: unknown): string {
  const ms = extractTimestampMs(val);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function designSortKey(d: CardDesignRecord): number {
  const ts = extractTimestampMs(d.updatedAt) || extractTimestampMs(d.createdAt);
  if (ts > 0) return ts;
  const tail = d.designId.split('_').pop();
  const parsed = tail ? Number(tail) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isOrderPaymentConfirmed(
  orders: OrderRecord[],
  profileId?: string,
  profileSlug?: string
): boolean {
  return orders.some((o) => {
    const matchesProfile =
      (!profileId && !profileSlug) ||
      (profileId && o.profileId === profileId) ||
      (profileSlug && o.profileSlug === profileSlug);
    return (
      Boolean(matchesProfile) &&
      (o.paymentStatus === 'Verified' ||
        o.paymentStatus === 'Completed' ||
        o.orderStatus === 'Delivered')
    );
  });
}

export function maskPhone(phone?: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\s+/g, ' ').trim();
  if (digits.length <= 5) return '***';
  return `${digits.slice(0, Math.min(5, digits.length - 3))}${'*'.repeat(Math.max(3, digits.length - 8))}${digits.slice(-3)}`;
}

export function maskEmail(email?: string): string {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const maskedLocal = local.length <= 2 ? `${local[0] || '*'}***` : `${local.slice(0, 2)}***`;
  const dotIdx = domain.lastIndexOf('.');
  if (dotIdx <= 1) return `${maskedLocal}@***`;
  const domainPrefix = domain.slice(0, 2);
  const tld = domain.slice(dotIdx);
  return `${maskedLocal}@${domainPrefix}***${tld}`;
}

export function calculateProfileCompletion(profile: ProfileRecord | null): number {
  if (!profile) return 0;
  const info = profile.personalInformation;
  const pType: ProfileType = profile.profileType || 'adult';

  let checks: boolean[];
  if (pType === 'kids') {
    checks = [
      Boolean(info.photoDataUrl),
      Boolean(info.fullName),
      Boolean(info.parentName),
      Boolean(info.parentMobile),
      Boolean(info.emergencyContactPhone || info.emergencyContactName),
      Boolean(info.bloodGroup),
      Boolean(info.city && info.state),
      Boolean(profile.slug),
    ];
  } else if (pType === 'pets') {
    checks = [
      Boolean(info.photoDataUrl),
      Boolean(info.fullName),
      Boolean(info.petType),
      Boolean(info.breed),
      Boolean(info.ownerName),
      Boolean(info.ownerMobile),
      Boolean(info.city && info.state),
      Boolean(profile.slug),
    ];
  } else if (pType === 'belongings') {
    checks = [
      Boolean(info.photoDataUrl),
      Boolean(info.fullName),
      Boolean(info.itemCategory && (info.itemCategory !== 'Other' || info.itemCategoryOther?.trim())),
      Boolean(info.ownerName),
      Boolean(info.ownerMobile),
      Boolean(info.finderNotes || info.brandModel),
      Boolean(info.city && info.state),
      Boolean(profile.slug),
    ];
  } else {
    checks = [
      Boolean(info.fullName),
      Boolean(info.jobTitle),
      Boolean(info.companyName),
      Boolean(info.shortBio),
      Boolean(info.mobile),
      Boolean(info.email),
      Boolean(info.city && info.state),
      Boolean(info.photoDataUrl),
      profile.socialLinks.filter((s) => s.enabled && s.url).length > 0,
      Boolean(profile.slug),
    ];
  }
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/**
 * Builds strictly sanitized public profile document containing ONLY fields permitted by visibilitySettings.
 * Private fields are NEVER copied to publicProfiles/{slug}.
 */
export function buildSanitizedPublicProfile(
  profile: ProfileRecord,
  inactiveMessage = DEFAULT_APP_SETTINGS.inactiveProfileMessage
): Omit<PublicProfileRecord, 'updatedAt'> {
  const v = profile.visibilitySettings;
  const info = profile.personalInformation;
  const profileType: ProfileType = profile.profileType || 'adult';

  if (!profile.isPublic || profile.adminDisabled) {
    return {
      slug: profile.slug,
      profileId: profile.profileId,
      uid: profile.uid,
      profileType,
      isPublic: Boolean(profile.isPublic),
      ...(profile.adminDisabled ? { adminDisabled: true } : {}),
      unavailableMessage: profile.adminDisabled
        ? 'This digital profile link has been disabled by the administrator.'
        : inactiveMessage,
    };
  }

  const publicInfo: Partial<PersonalInformation> = {};
  if (v.photo && info.photoDataUrl) publicInfo.photoDataUrl = info.photoDataUrl;
  if (v.fullName && info.fullName) publicInfo.fullName = info.fullName;
  if (v.shortBio && info.shortBio) publicInfo.shortBio = sanitizeRichBioHtml(info.shortBio);
  if (v.mobile && info.mobile) publicInfo.mobile = info.mobile;
  if (v.alternateMobile && info.alternateMobile) publicInfo.alternateMobile = info.alternateMobile;
  if (v.whatsapp && info.whatsapp) publicInfo.whatsapp = info.whatsapp;
  if (v.email && info.email) publicInfo.email = info.email;
  if (v.alternateEmail && info.alternateEmail) publicInfo.alternateEmail = info.alternateEmail;
  if (v.website && info.website) publicInfo.website = info.website;

  // Adult professional & ID fields (strictly excluded from kids / pets / belongings profiles)
  if (profileType === 'adult') {
    if (v.jobTitle && info.jobTitle) publicInfo.jobTitle = info.jobTitle;
    if (v.companyName && info.companyName) publicInfo.companyName = info.companyName;
    if (v.businessCategory && info.businessCategory) publicInfo.businessCategory = info.businessCategory;
    if (v.aadhaarNumber && info.aadhaarNumber) publicInfo.aadhaarNumber = info.aadhaarNumber;
    if (v.panNumber && info.panNumber) publicInfo.panNumber = info.panNumber;
  }

  // Address fields
  if (v.businessAddress || (profileType !== 'adult' && v.personalAddress)) {
    if (info.businessAddress) publicInfo.businessAddress = info.businessAddress;
    if (info.city) publicInfo.city = info.city;
    if (info.state) publicInfo.state = info.state;
    if (info.pinCode) publicInfo.pinCode = info.pinCode;
    if (info.country) publicInfo.country = info.country;
  }
  if (v.personalAddress && info.personalAddress) {
    publicInfo.personalAddress = info.personalAddress;
  }

  // Shared emergency & blood group fields
  if (profileType === 'adult' || profileType === 'kids') {
    if ((v.bloodGroup ?? true) && info.bloodGroup) publicInfo.bloodGroup = info.bloodGroup;
  }
  if (profileType === 'adult' || profileType === 'kids' || profileType === 'pets' || profileType === 'belongings') {
    if (v.emergencyContact ?? true) {
      if (info.emergencyContactName) publicInfo.emergencyContactName = info.emergencyContactName;
      if (info.emergencyContactRelation) publicInfo.emergencyContactRelation = info.emergencyContactRelation;
      if (info.emergencyContactPhone) publicInfo.emergencyContactPhone = info.emergencyContactPhone;
    }
  }

  // Kids fields
  if (profileType === 'kids') {
    if ((v.dateOfBirth ?? true) && info.dateOfBirth) publicInfo.dateOfBirth = info.dateOfBirth;
    if (v.parentContact ?? true) {
      if (info.parentName) publicInfo.parentName = info.parentName;
      if (info.parentMobile) publicInfo.parentMobile = info.parentMobile;
    }
    if ((v.schoolOrClass ?? true) && info.schoolOrClass) publicInfo.schoolOrClass = info.schoolOrClass;
    if (v.medicalInfo ?? true) {
      if (info.allergiesOrMedical) publicInfo.allergiesOrMedical = info.allergiesOrMedical;
      if (info.specialNotes) publicInfo.specialNotes = info.specialNotes;
    }
  }

  // Pets fields
  if (profileType === 'pets') {
    if (v.petDetails ?? true) {
      if (info.petType) publicInfo.petType = info.petType;
      if (info.breed) publicInfo.breed = info.breed;
      if (info.petGender) publicInfo.petGender = info.petGender;
      if (info.petColor) publicInfo.petColor = info.petColor;
      if (info.microchipId) publicInfo.microchipId = info.microchipId;
      if (info.dateOfBirth) publicInfo.dateOfBirth = info.dateOfBirth;
    }
    if (v.ownerContact ?? true) {
      if (info.ownerName) publicInfo.ownerName = info.ownerName;
      if (info.ownerMobile) publicInfo.ownerMobile = info.ownerMobile;
    }
    if (v.vetContact ?? true) {
      if (info.vetName) publicInfo.vetName = info.vetName;
      if (info.vetPhone) publicInfo.vetPhone = info.vetPhone;
    }
    if ((v.medicalInfo ?? true) && info.allergiesOrMedical) {
      publicInfo.allergiesOrMedical = info.allergiesOrMedical;
    }
  }

  // Personal Belongings fields
  if (profileType === 'belongings') {
    if (v.itemDetails ?? true) {
      if (info.itemCategory) publicInfo.itemCategory = info.itemCategory;
      if (info.itemCategory === 'Other' && info.itemCategoryOther?.trim()) {
        publicInfo.itemCategoryOther = info.itemCategoryOther.trim();
      }
      if (info.brandModel) publicInfo.brandModel = info.brandModel;
      if (info.serialNumber) publicInfo.serialNumber = info.serialNumber;
    }
    if (v.ownerContact ?? true) {
      if (info.ownerName) publicInfo.ownerName = info.ownerName;
      if (info.ownerMobile) publicInfo.ownerMobile = info.ownerMobile;
    }
    if ((v.finderNotes ?? true) && info.finderNotes) {
      publicInfo.finderNotes = info.finderNotes;
    }
  }

  const publicSocials: SocialLinkItem[] = (profile.socialLinks || [])
    .filter((link) => {
      if (!link.url) return false;
      const explicitVis = v.socialLinks?.[link.id];
      return explicitVis !== undefined ? Boolean(explicitVis) : Boolean(link.enabled);
    })
    .sort((a, b) => a.order - b.order);

  const publicCustomFields: CustomFieldItem[] = (profile.customFields || [])
    .filter((field) => field.visible && field.label && field.value)
    .sort((a, b) => a.order - b.order);

  return {
    slug: profile.slug,
    profileId: profile.profileId,
    uid: profile.uid,
    profileType,
    isPublic: true,
    personalInformation: publicInfo,
    socialLinks: publicSocials,
    customFields: publicCustomFields,
    themeColor: '#0B1D3A',
    ...(profile.paymentConfirmed ? { paymentConfirmed: true } : {}),
    ...(profile.paymentCompletedAt ? { paymentCompletedAt: profile.paymentCompletedAt } : {}),
    ...(profile.adminApproved ? { adminApproved: true } : {}),
    ...(profile.adminApprovedAt ? { adminApprovedAt: profile.adminApprovedAt } : {}),
    ...(profile.adminApprovedBy ? { adminApprovedBy: profile.adminApprovedBy } : {}),
  };
}

// --- Audit Log ---
export async function recordAuditLog(params: {
  actorUid: string;
  actorEmail?: string;
  actorRole: UserRole | 'SYSTEM';
  action: string;
  targetCollection: string;
  targetId: string;
  details?: string;
}): Promise<void> {
  const ref = doc(collection(db, 'auditLogs'));
  try {
    await setDoc(ref, {
      logId: ref.id,
      actorUid: params.actorUid,
      actorEmail: params.actorEmail || '',
      actorRole: params.actorRole,
      action: params.action,
      targetCollection: params.targetCollection,
      targetId: params.targetId,
      details: (params.details || '').slice(0, 980),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Audit log write warning:', err);
  }
}

// --- App Settings & Multi-Gateway Config ---
export function mergePaymentGateways(
  raw?: Partial<Record<PaymentGatewayId, Partial<PaymentGatewayConfig>>> | null
): Record<PaymentGatewayId, PaymentGatewayConfig> {
  const merged = {} as Record<PaymentGatewayId, PaymentGatewayConfig>;
  for (const id of PAYMENT_GATEWAY_ORDER) {
    const def = DEFAULT_PAYMENT_GATEWAYS[id];
    const incoming = raw?.[id] || {};
    merged[id] = {
      id,
      label: typeof incoming.label === 'string' && incoming.label.trim() ? incoming.label.trim() : def.label,
      enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : def.enabled,
      mode: incoming.mode === 'live' ? 'live' : 'sandbox',
      publicKeyId: typeof incoming.publicKeyId === 'string' ? incoming.publicKeyId : def.publicKeyId || '',
      merchantId: typeof incoming.merchantId === 'string' ? incoming.merchantId : def.merchantId || '',
      upiId: typeof incoming.upiId === 'string' ? incoming.upiId : def.upiId || '',
      upiPayeeName: typeof incoming.upiPayeeName === 'string' ? incoming.upiPayeeName : def.upiPayeeName || '',
      description: typeof incoming.description === 'string' ? incoming.description : def.description || '',
    };
  }
  return merged;
}

export async function getAppSettings(): Promise<AppSettingsRecord> {
  try {
    const snap = await getDoc(doc(db, 'appSettings', 'global'));
    if (snap.exists()) {
      const data = snap.data() as Partial<AppSettingsRecord>;
      return {
        ...DEFAULT_APP_SETTINGS,
        ...data,
        paymentGateways: mergePaymentGateways(data.paymentGateways),
      };
    }
    return {
      ...DEFAULT_APP_SETTINGS,
      paymentGateways: mergePaymentGateways(DEFAULT_PAYMENT_GATEWAYS),
    };
  } catch {
    return {
      ...DEFAULT_APP_SETTINGS,
      paymentGateways: mergePaymentGateways(DEFAULT_PAYMENT_GATEWAYS),
    };
  }
}

export async function saveAppSettings(
  settings: Partial<AppSettingsRecord>,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  const path = 'appSettings/global';
  try {
    const existing = await getAppSettings();
    const nextPaymentGateways = settings.paymentGateways
      ? mergePaymentGateways(settings.paymentGateways)
      : existing.paymentGateways || mergePaymentGateways(DEFAULT_PAYMENT_GATEWAYS);

    await setDoc(
      doc(db, 'appSettings', 'global'),
      {
        ...DEFAULT_APP_SETTINGS,
        ...existing,
        ...settings,
        paymentGateways: nextPaymentGateways,
        settingId: 'global',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'UPDATE_APP_SETTINGS',
      targetCollection: 'appSettings',
      targetId: 'global',
      details: `Updated global settings (${Object.keys(settings).join(', ')})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// --- Profiles ---
export async function getUserProfiles(uid: string): Promise<ProfileRecord[]> {
  const path = 'profiles';
  try {
    const q = query(collection(db, 'profiles'), where('uid', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ProfileRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function isSlugAvailable(slug: string, currentProfileId?: string): Promise<boolean> {
  const clean = sanitizeSlug(slug);
  if (clean.length < 3) return false;
  try {
    const snap = await getDoc(doc(db, 'publicProfiles', clean));
    if (!snap.exists()) return true;
    const data = snap.data() as PublicProfileRecord;
    return Boolean(currentProfileId && data.profileId === currentProfileId);
  } catch {
    return false;
  }
}

export async function ensureUniqueAutoProfileSlug(
  seedName?: string,
  excludeProfileId?: string
): Promise<string> {
  for (let i = 0; i < 4; i++) {
    const candidate = generateAutoProfileSlug(seedName);
    if (await isSlugAvailable(candidate, excludeProfileId)) {
      return candidate;
    }
  }
  return `tpnx-${Date.now().toString(36)}`;
}

function defaultTemplateForProfileType(profileType: ProfileType): string {
  if (profileType === 'kids') return 'kids-safety-sky';
  if (profileType === 'pets') return 'pets-collar-emerald';
  if (profileType === 'belongings') return 'belongings-finder-amber';
  return 'azure-tech-waves';
}

export async function ensureDefaultProfile(user: UserRecord): Promise<ProfileRecord> {
  const existing = await getUserProfiles(user.uid);
  if (existing.length > 0) return existing[0];

  const uidSuffix = user.uid.slice(0, 4).toLowerCase();
  const baseName = sanitizeSlug(user.displayName || user.username || user.email.split('@')[0] || 'member');
  let slug = baseName.length >= 3 ? baseName : `card-${user.uid.slice(0, 6).toLowerCase()}`;
  if (!(await isSlugAvailable(slug))) {
    slug = `${slug.slice(0, 54).replace(/-+$/, '')}-${uidSuffix}`;
    if (!(await isSlugAvailable(slug))) {
      slug = `${slug.slice(0, 46).replace(/-+$/, '')}-${Date.now().toString(36).slice(-6)}`;
    }
  }

  const profileId = `prof_${user.uid}`;
  const newProfile: ProfileRecord = {
    profileId,
    uid: user.uid,
    profileType: 'adult',
    profileLabel: 'Primary Business Profile',
    slug,
    personalInformation: {
      ...EMPTY_PERSONAL_INFO,
      fullName: user.displayName || '',
      email: user.email || '',
      photoDataUrl: user.photoURL || '',
    },
    socialLinks: [],
    customFields: [],
    visibilitySettings: DEFAULT_VISIBILITY,
    selectedTemplate: 'azure-tech-waves',
    isPublic: true,
    viewsCount: 0,
    qrScansCount: 0,
    nfcVisitsCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'profiles', profileId), newProfile);
  batch.set(doc(db, 'publicProfiles', slug), {
    ...buildSanitizedPublicProfile(newProfile),
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `profiles/${profileId}`);
  }
  return newProfile;
}

export async function createAdditionalProfile(
  uid: string,
  label: string,
  desiredSlug?: string,
  baseInfo?: Partial<PersonalInformation>,
  profileType: ProfileType = 'adult'
): Promise<ProfileRecord> {
  const candidateSlug = desiredSlug ? sanitizeSlug(desiredSlug) : '';
  const cleanSlug =
    candidateSlug.length >= 3 && (await isSlugAvailable(candidateSlug))
      ? candidateSlug
      : await ensureUniqueAutoProfileSlug(baseInfo?.fullName || label);

  const profileId = `prof_${uid.slice(0, 8)}_${Date.now()}`;
  const profile: ProfileRecord = {
    profileId,
    uid,
    profileType,
    profileLabel: label.slice(0, 80) || 'Digital Profile',
    slug: cleanSlug,
    personalInformation: { ...EMPTY_PERSONAL_INFO, ...baseInfo },
    socialLinks: [],
    customFields: [],
    visibilitySettings: DEFAULT_VISIBILITY,
    selectedTemplate: defaultTemplateForProfileType(profileType),
    isPublic: true,
    viewsCount: 0,
    qrScansCount: 0,
    nfcVisitsCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'profiles', profileId), profile);
  batch.set(doc(db, 'publicProfiles', cleanSlug), {
    ...buildSanitizedPublicProfile(profile),
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `profiles/${profileId}`);
  }
  return profile;
}

export async function saveProfileAndSyncPublic(
  profile: ProfileRecord,
  previousSlug?: string,
  inactiveMessage?: string
): Promise<void> {
  const batch = writeBatch(db);
  const cleanSlug = sanitizeSlug(profile.slug);
  let normalizedPhoto = profile.personalInformation?.photoDataUrl || '';
  if (normalizedPhoto.startsWith('data:image/') && normalizedPhoto.length > 180_000) {
    try {
      normalizedPhoto = await compressDataUrlWithinBudget(normalizedPhoto, {
        maxWidth: 420,
        maxHeight: 420,
        maxChars: 160_000,
        preserveAlpha: true,
      });
    } catch {
      // Keep original if headless or decode fails
    }
  }
  const updatedProfile: ProfileRecord = {
    ...profile,
    slug: cleanSlug,
    personalInformation: {
      ...profile.personalInformation,
      ...(normalizedPhoto !== (profile.personalInformation?.photoDataUrl || '')
        ? { photoDataUrl: normalizedPhoto }
        : {}),
    },
  };

  let existingPublicDocExists = false;
  try {
    const existingPub = await getDoc(doc(db, 'publicProfiles', cleanSlug));
    existingPublicDocExists = existingPub.exists();
  } catch {
    // ignore read fallback
  }

  batch.set(
    doc(db, 'profiles', profile.profileId),
    {
      profileType: updatedProfile.profileType || 'adult',
      profileLabel: updatedProfile.profileLabel || 'Primary Business Profile',
      slug: cleanSlug,
      personalInformation: updatedProfile.personalInformation,
      socialLinks: updatedProfile.socialLinks,
      customFields: updatedProfile.customFields,
      visibilitySettings: updatedProfile.visibilitySettings,
      selectedTemplate: updatedProfile.selectedTemplate,
      isPublic: updatedProfile.isPublic,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (previousSlug && previousSlug !== cleanSlug) {
    batch.delete(doc(db, 'publicProfiles', previousSlug));
  }

  const sanitizedPublic = buildSanitizedPublicProfile(updatedProfile, inactiveMessage);
  if (existingPublicDocExists && (!previousSlug || previousSlug === cleanSlug)) {
    batch.update(doc(db, 'publicProfiles', cleanSlug), {
      profileType: sanitizedPublic.profileType || 'adult',
      isPublic: sanitizedPublic.isPublic,
      unavailableMessage: sanitizedPublic.unavailableMessage || '',
      personalInformation: sanitizedPublic.personalInformation || {},
      socialLinks: sanitizedPublic.socialLinks || [],
      customFields: sanitizedPublic.customFields || [],
      updatedAt: serverTimestamp(),
    });
  } else {
    const {
      paymentConfirmed: _omitPayConfirmed,
      paymentCompletedAt: _omitPayCompletedAt,
      lastPaidOrderId: _omitLastPaidOrderId,
      ...safePublicCreate
    } = sanitizedPublic;
    batch.set(doc(db, 'publicProfiles', cleanSlug), {
      ...safePublicCreate,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `profiles/${profile.profileId}`);
  }
}

export async function getPublicProfileBySlug(slug: string): Promise<PublicProfileRecord | null> {
  const clean = sanitizeSlug(slug);
  if (!clean) return null;
  try {
    const snap = await getDoc(doc(db, 'publicProfiles', clean));
    return snap.exists() ? (snap.data() as PublicProfileRecord) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `publicProfiles/${clean}`);
  }
}

export async function getAllProfiles(): Promise<ProfileRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'profiles'));
    return snap.docs.map((d) => d.data() as ProfileRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'profiles');
  }
}

export async function getProfileById(profileId: string): Promise<ProfileRecord | null> {
  if (!profileId) return null;
  try {
    const snap = await getDoc(doc(db, 'profiles', profileId));
    return snap.exists() ? (snap.data() as ProfileRecord) : null;
  } catch {
    return null;
  }
}

export async function adminToggleProfileStatus(params: {
  profile: ProfileRecord;
  isPublic: boolean;
  actor: { uid: string; email?: string; role: UserRole };
  inactiveMessage?: string;
}): Promise<ProfileRecord> {
  const adminDisabled = !params.isPublic;
  const updated: ProfileRecord = { ...params.profile, isPublic: params.isPublic, adminDisabled };
  let existingPubExists = false;
  try {
    const existingPub = await getDoc(doc(db, 'publicProfiles', params.profile.slug));
    existingPubExists = existingPub.exists();
  } catch {
    // ignore read fallback
  }

  const sanitizedPublic = buildSanitizedPublicProfile(updated, params.inactiveMessage);
  const {
    paymentConfirmed: _omitPayConfirmed,
    paymentCompletedAt: _omitPayCompletedAt,
    lastPaidOrderId: _omitLastPaidOrderId,
    ...safePublicCreate
  } = sanitizedPublic;

  const batch = writeBatch(db);
  batch.update(doc(db, 'profiles', params.profile.profileId), {
    isPublic: params.isPublic,
    adminDisabled,
    updatedAt: serverTimestamp(),
  });
  if (existingPubExists) {
    batch.update(doc(db, 'publicProfiles', params.profile.slug), {
      isPublic: sanitizedPublic.isPublic,
      unavailableMessage: sanitizedPublic.unavailableMessage || '',
      adminDisabled,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(doc(db, 'publicProfiles', params.profile.slug), {
      ...safePublicCreate,
      adminDisabled,
      ...(params.profile.adminApproved
        ? {
            adminApproved: true,
            ...(params.profile.adminApprovedAt ? { adminApprovedAt: params.profile.adminApprovedAt } : {}),
            ...(params.profile.adminApprovedBy ? { adminApprovedBy: params.profile.adminApprovedBy } : {}),
          }
        : {}),
      updatedAt: serverTimestamp(),
    });
  }
  try {
    await batch.commit();
    await recordAuditLog({
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: params.isPublic ? 'ENABLE_DIGITAL_PROFILE' : 'DISABLE_DIGITAL_PROFILE',
      targetCollection: 'profiles',
      targetId: params.profile.profileId,
      details: `${params.isPublic ? 'Enabled' : 'Disabled'} digital profile /p/${params.profile.slug}`,
    });
    return updated;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `profiles/${params.profile.profileId}`);
  }
}

export async function adminSetProfileApproval(params: {
  profile: ProfileRecord;
  approved: boolean;
  actor: { uid: string; email?: string; role: UserRole };
  inactiveMessage?: string;
}): Promise<ProfileRecord> {
  const approvedAt = params.approved ? new Date().toISOString() : '';
  const approvedBy = params.approved ? params.actor.email || params.actor.uid : '';
  const updated: ProfileRecord = {
    ...params.profile,
    isPublic: params.approved ? true : params.profile.isPublic,
    adminDisabled: params.approved ? false : Boolean(params.profile.adminDisabled),
    adminApproved: params.approved,
    adminApprovedAt: approvedAt,
    adminApprovedBy: approvedBy,
  };

  let existingPubExists = false;
  try {
    const existingPub = await getDoc(doc(db, 'publicProfiles', params.profile.slug));
    existingPubExists = existingPub.exists();
  } catch {
    // ignore read fallback
  }

  const sanitizedPublic = buildSanitizedPublicProfile(updated, params.inactiveMessage);
  const {
    paymentConfirmed: _omitPayConfirmed,
    paymentCompletedAt: _omitPayCompletedAt,
    lastPaidOrderId: _omitLastPaidOrderId,
    ...safePublicCreate
  } = sanitizedPublic;

  const batch = writeBatch(db);
  batch.update(doc(db, 'profiles', params.profile.profileId), {
    isPublic: updated.isPublic,
    adminDisabled: Boolean(updated.adminDisabled),
    adminApproved: params.approved,
    adminApprovedAt: approvedAt,
    adminApprovedBy: approvedBy,
    updatedAt: serverTimestamp(),
  });
  if (existingPubExists) {
    batch.update(doc(db, 'publicProfiles', params.profile.slug), {
      isPublic: sanitizedPublic.isPublic,
      unavailableMessage: sanitizedPublic.unavailableMessage || '',
      adminDisabled: Boolean(updated.adminDisabled),
      adminApproved: params.approved,
      adminApprovedAt: approvedAt,
      adminApprovedBy: approvedBy,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(doc(db, 'publicProfiles', params.profile.slug), {
      ...safePublicCreate,
      adminDisabled: Boolean(updated.adminDisabled),
      adminApproved: params.approved,
      adminApprovedAt: approvedAt,
      adminApprovedBy: approvedBy,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    await recordAuditLog({
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: params.approved ? 'ADMIN_APPROVE_PROFILE' : 'ADMIN_REVOKE_PROFILE_APPROVAL',
      targetCollection: 'profiles',
      targetId: params.profile.profileId,
      details: `${params.approved ? 'Approved' : 'Revoked approval for'} /p/${params.profile.slug} (payment optional)`,
    });
    return updated;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `profiles/${params.profile.profileId}`);
  }
}

export async function deleteDigitalProfile(params: {
  profile: ProfileRecord;
  actor: { uid: string; email?: string; role: UserRole };
}): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'profiles', params.profile.profileId));
  if (params.profile.slug) {
    batch.delete(doc(db, 'publicProfiles', params.profile.slug));
  }
  try {
    await batch.commit();
    await recordAuditLog({
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: 'DELETE_DIGITAL_PROFILE',
      targetCollection: 'profiles',
      targetId: params.profile.profileId,
      details: `Deleted digital profile /p/${params.profile.slug} (owner ${params.profile.uid})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `profiles/${params.profile.profileId}`);
  }
}

// --- Card Templates & Designs ---
export function sortCardTemplates(list: CardTemplateRecord[]): CardTemplateRecord[] {
  return [...list].sort((a, b) => {
    const defDiff = (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0);
    if (defDiff !== 0) return defDiff;
    return a.name.localeCompare(b.name);
  });
}

function toFirestoreCardTemplate(t: CardTemplateRecord): Omit<CardTemplateRecord, 'updatedAt'> {
  return {
    templateId: t.templateId,
    name: t.name,
    category: t.category || 'Executive',
    profileType: t.profileType || 'adult',
    designTier: t.designTier || 'designer',
    pricingMode: t.pricingMode || 'card_tiers',
    ...(t.packNote ? { packNote: t.packNote } : {}),
    ...(t.tagKeywords && t.tagKeywords.length > 0 ? { tagKeywords: t.tagKeywords } : {}),
    description: t.description || '',
    priceInr: Math.max(0, Number(t.priceInr) || 0),
    cardType: t.cardType || 'Matte PVC SMART',
    active: Boolean(t.active),
    isDefault: Boolean(t.isDefault),
    supportsVertical: Boolean(t.supportsVertical),
    frontSpec: t.frontSpec,
    backSpec: t.backSpec,
  };
}

const RETIRED_CARD_TEMPLATE_IDS = new Set(['belongings-helmet-accident-sos']);

function hydrateTemplateWithDefaults(rec: CardTemplateRecord): CardTemplateRecord {
  const def = DEFAULT_CARD_TEMPLATES.find((d) => d.templateId === rec.templateId);
  if (!def) return rec;
  return {
    ...rec,
    designTier: rec.designTier || def.designTier,
    pricingMode: rec.pricingMode || def.pricingMode,
    packNote: rec.packNote || def.packNote,
    tagKeywords: rec.tagKeywords || def.tagKeywords,
  };
}

export async function getCardTemplates(includeInactive = false): Promise<CardTemplateRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'cardTemplates'));
    if (snap.empty) {
      const sorted = sortCardTemplates(DEFAULT_CARD_TEMPLATES);
      return includeInactive ? sorted : sorted.filter((t) => t.active);
    }
    const stored = snap.docs
      .map((d) => hydrateTemplateWithDefaults(d.data() as CardTemplateRecord))
      .filter((t) => !RETIRED_CARD_TEMPLATE_IDS.has(t.templateId));
    const storedIds = new Set(stored.map((t) => t.templateId));
    const hasAzureWaves = storedIds.has('azure-tech-waves');
    const hasExplicitNonNavyDefault = stored.some((t) => t.isDefault && t.templateId !== 'premium-navy');
    const normalizedStored =
      !hasAzureWaves && !hasExplicitNonNavyDefault
        ? stored.map((t) => (t.templateId === 'premium-navy' ? { ...t, isDefault: false } : t))
        : stored;
    const anyStoredDefault = normalizedStored.some((t) => t.isDefault);
    const missingDefaults = DEFAULT_CARD_TEMPLATES.filter((d) => !storedIds.has(d.templateId)).map((d) =>
      anyStoredDefault ? { ...d, isDefault: false } : d
    );
    const items = sortCardTemplates([...normalizedStored, ...missingDefaults]);
    return includeInactive ? items : items.filter((t) => t.active);
  } catch {
    const sorted = sortCardTemplates(DEFAULT_CARD_TEMPLATES);
    return includeInactive ? sorted : sorted.filter((t) => t.active);
  }
}

export async function saveCardTemplate(
  template: CardTemplateRecord,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  const path = `cardTemplates/${template.templateId}`;
  try {
    const existingSnap = await getDocs(collection(db, 'cardTemplates'));
    const normalizedInput: CardTemplateRecord = {
      ...template,
      active: template.isDefault ? true : Boolean(template.active),
      isDefault: Boolean(template.isDefault),
    };

    const existingList = existingSnap.docs
      .map((d) => d.data() as CardTemplateRecord)
      .filter((t) => !RETIRED_CARD_TEMPLATE_IDS.has(t.templateId));
    const existingIds = new Set(existingList.map((t) => t.templateId));
    const missingDefaults = DEFAULT_CARD_TEMPLATES.filter((d) => !existingIds.has(d.templateId));

    if (existingSnap.empty || missingDefaults.length > 0 || normalizedInput.isDefault) {
      const mergedMap = new Map<string, CardTemplateRecord>();
      for (const def of DEFAULT_CARD_TEMPLATES) {
        mergedMap.set(def.templateId, def);
      }
      for (const ex of existingList) {
        mergedMap.set(ex.templateId, ex);
      }
      mergedMap.set(normalizedInput.templateId, normalizedInput);

      const batch = writeBatch(db);
      for (const retiredId of RETIRED_CARD_TEMPLATE_IDS) {
        batch.delete(doc(db, 'cardTemplates', retiredId));
      }
      for (const item of mergedMap.values()) {
        const finalItem: CardTemplateRecord = normalizedInput.isDefault
          ? {
              ...item,
              isDefault: item.templateId === normalizedInput.templateId,
              active: item.templateId === normalizedInput.templateId ? true : item.active,
            }
          : item;
        batch.set(doc(db, 'cardTemplates', finalItem.templateId), {
          ...toFirestoreCardTemplate(finalItem),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } else {
      await setDoc(doc(db, 'cardTemplates', normalizedInput.templateId), {
        ...toFirestoreCardTemplate(normalizedInput),
        updatedAt: serverTimestamp(),
      });
    }
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'SAVE_CARD_TEMPLATE',
      targetCollection: 'cardTemplates',
      targetId: normalizedInput.templateId,
      details: `Saved template ${normalizedInput.name} (₹${normalizedInput.priceInr}, visible=${normalizedInput.active}, default=${Boolean(normalizedInput.isDefault)})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function setDefaultCardTemplate(
  templateId: string,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  const path = `cardTemplates/${templateId}`;
  try {
    const existingSnap = await getDocs(collection(db, 'cardTemplates'));
    const mergedMap = new Map<string, CardTemplateRecord>();
    for (const def of DEFAULT_CARD_TEMPLATES) {
      mergedMap.set(def.templateId, def);
    }
    for (const d of existingSnap.docs) {
      const rec = d.data() as CardTemplateRecord;
      if (!RETIRED_CARD_TEMPLATE_IDS.has(rec.templateId)) {
        mergedMap.set(rec.templateId, rec);
      }
    }
    const target = mergedMap.get(templateId);
    if (!target) {
      throw new Error(`Template ${templateId} not found.`);
    }
    const batch = writeBatch(db);
    for (const retiredId of RETIRED_CARD_TEMPLATE_IDS) {
      batch.delete(doc(db, 'cardTemplates', retiredId));
    }
    for (const item of mergedMap.values()) {
      const isSelectedDefault = item.templateId === templateId;
      batch.set(doc(db, 'cardTemplates', item.templateId), {
        ...toFirestoreCardTemplate({
          ...item,
          isDefault: isSelectedDefault,
          active: isSelectedDefault ? true : item.active,
        }),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'SET_DEFAULT_CARD_TEMPLATE',
      targetCollection: 'cardTemplates',
      targetId: templateId,
      details: `Set "${target.name}" as default card template`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function setBulkCardTemplatesVisibility(
  active: boolean,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  try {
    const existingSnap = await getDocs(collection(db, 'cardTemplates'));
    const mergedMap = new Map<string, CardTemplateRecord>();
    for (const def of DEFAULT_CARD_TEMPLATES) {
      mergedMap.set(def.templateId, def);
    }
    for (const d of existingSnap.docs) {
      const rec = d.data() as CardTemplateRecord;
      if (!RETIRED_CARD_TEMPLATE_IDS.has(rec.templateId)) {
        mergedMap.set(rec.templateId, rec);
      }
    }
    const batch = writeBatch(db);
    for (const retiredId of RETIRED_CARD_TEMPLATE_IDS) {
      batch.delete(doc(db, 'cardTemplates', retiredId));
    }
    for (const item of mergedMap.values()) {
      batch.set(doc(db, 'cardTemplates', item.templateId), {
        ...toFirestoreCardTemplate({
          ...item,
          active,
        }),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'BULK_TOGGLE_CARD_TEMPLATES',
      targetCollection: 'cardTemplates',
      targetId: 'all',
      details: `Set all templates visibility to ${active ? 'enabled' : 'disabled'}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'cardTemplates');
  }
}

export async function deleteCardTemplate(
  templateId: string,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  try {
    const existingSnap = await getDocs(collection(db, 'cardTemplates'));
    if (existingSnap.empty) {
      const batch = writeBatch(db);
      for (const def of DEFAULT_CARD_TEMPLATES) {
        if (def.templateId !== templateId) {
          batch.set(doc(db, 'cardTemplates', def.templateId), {
            ...toFirestoreCardTemplate(def),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    } else {
      await deleteDoc(doc(db, 'cardTemplates', templateId));
    }
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'DELETE_CARD_TEMPLATE',
      targetCollection: 'cardTemplates',
      targetId: templateId,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `cardTemplates/${templateId}`);
  }
}

export async function getUserDesigns(uid: string): Promise<CardDesignRecord[]> {
  try {
    const q = query(collection(db, 'cardDesigns'), where('uid', '==', uid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as CardDesignRecord)
      .sort((a, b) => designSortKey(b) - designSortKey(a));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'cardDesigns');
  }
}

export async function getAllCardDesigns(): Promise<CardDesignRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'cardDesigns'));
    return snap.docs
      .map((d) => d.data() as CardDesignRecord)
      .sort((a, b) => designSortKey(b) - designSortKey(a));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'cardDesigns');
  }
}

export async function deleteCardDesign(
  designId: string,
  actor: { uid: string; email?: string; role: UserRole },
  details?: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'cardDesigns', designId));
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'DELETE_CARD_DESIGN',
      targetCollection: 'cardDesigns',
      targetId: designId,
      details: details || `Deleted card design ${designId}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `cardDesigns/${designId}`);
  }
}

export async function getCardDesignById(designId: string): Promise<CardDesignRecord | null> {
  try {
    const snap = await getDoc(doc(db, 'cardDesigns', designId));
    return snap.exists() ? (snap.data() as CardDesignRecord) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `cardDesigns/${designId}`);
  }
}

export async function saveCardDesign(
  design: Omit<CardDesignRecord, 'createdAt' | 'updatedAt'>,
  options?: { isExisting?: boolean }
): Promise<Omit<CardDesignRecord, 'createdAt' | 'updatedAt'>> {
  const ref = doc(db, 'cardDesigns', design.designId);
  const approvedAt = design.approved ? design.approvedAt || new Date().toISOString() : '';
  const cardTechnology =
    design.cardTechnology || (design.frontDesign?.showNfcIcon ? 'qr_smart' : 'qr_only');
  const rawPayload: Omit<CardDesignRecord, 'createdAt' | 'updatedAt'> = {
    designId: design.designId,
    uid: design.uid,
    profileId: design.profileId,
    ...(design.orderId ? { orderId: design.orderId } : {}),
    templateId: design.templateId,
    cardTechnology,
    frontDesign: design.frontDesign,
    backDesign: design.backDesign,
    cardOrientation: design.cardOrientation,
    dimensions: design.dimensions,
    bleed: design.bleed,
    approved: Boolean(design.approved),
    locked: Boolean(design.locked),
    approvedAt,
    version: Math.max(1, Number(design.version) || 1),
  };

  const payload = await prepareCardDesignForFirestore(rawPayload);

  try {
    if (options?.isExisting) {
      await updateDoc(ref, {
        templateId: payload.templateId,
        cardTechnology: payload.cardTechnology,
        frontDesign: payload.frontDesign,
        backDesign: payload.backDesign,
        cardOrientation: payload.cardOrientation,
        dimensions: payload.dimensions,
        approved: payload.approved,
        approvedAt: payload.approvedAt,
        locked: payload.locked,
        version: payload.version,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `cardDesigns/${design.designId}`);
  }
}

// --- Orders, Payments, & Post-Payment QR Generation ---
export async function createPendingOrder(params: {
  orderId: string;
  orderNumber: string;
  uid: string;
  profileId: string;
  profileSlug: string;
  designId: string;
  quantity: number;
  cardType: string;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  shippingAddress: ShippingAddress;
}): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'orders', params.orderId), {
    orderId: params.orderId,
    orderNumber: params.orderNumber,
    uid: params.uid,
    profileId: params.profileId,
    profileSlug: params.profileSlug,
    designId: params.designId,
    printerId: '',
    quantity: params.quantity,
    cardType: params.cardType,
    subtotal: params.subtotal,
    tax: params.tax,
    shipping: params.shipping,
    total: params.total,
    currency: 'INR',
    paymentStatus: 'Pending',
    orderStatus: 'Awaiting Payment',
    shippingAddress: params.shippingAddress,
    qrCodeId: '',
    printFileReady: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Lock approved design against accidental customer edits once order checkout starts
  batch.update(doc(db, 'cardDesigns', params.designId), {
    approved: true,
    locked: true,
    orderId: params.orderId,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `orders/${params.orderId}`);
  }
}

export async function createPendingShopOrder(params: {
  orderId: string;
  orderNumber: string;
  uid: string;
  profileId?: string;
  profileSlug?: string;
  shopItems: OrderShopItem[];
  quantity: number;
  cardType: string;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  shippingAddress: ShippingAddress;
  notes?: string;
}): Promise<void> {
  try {
    await setDoc(doc(db, 'orders', params.orderId), {
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      uid: params.uid,
      profileId: params.profileId || 'shop_cart',
      profileSlug: params.profileSlug || '',
      designId: 'shop_direct',
      orderSource: 'shop',
      shopItems: params.shopItems,
      printerId: '',
      quantity: Math.max(1, Number(params.quantity) || 1),
      cardType: params.cardType.slice(0, 80) || 'TapNex Smart Tag Order',
      subtotal: params.subtotal,
      tax: params.tax,
      shipping: params.shipping,
      total: params.total,
      currency: 'INR',
      paymentStatus: 'Pending',
      orderStatus: 'Awaiting Payment',
      shippingAddress: params.shippingAddress,
      qrCodeId: '',
      printFileReady: false,
      ...(params.notes ? { internalNotes: params.notes.slice(0, 1800) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `orders/${params.orderId}`);
  }
}

export async function getCustomerOrders(uid: string): Promise<OrderRecord[]> {
  try {
    const q = query(collection(db, 'orders'), where('uid', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as OrderRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'orders');
  }
}

export async function getPrinterOrders(printerUid: string): Promise<OrderRecord[]> {
  try {
    // The printer document is keyed by Firebase Auth UID, while orders retain the stable Print Auth ID.
    const printerSnap = await getDoc(doc(db, 'printers', printerUid));
    if (!printerSnap.exists()) return [];
    const printer = printerSnap.data() as PrinterRecord;
    if (
      printer.uid !== printerUid ||
      printer.status !== 'Active' ||
      typeof printer.printerId !== 'string' ||
      !printer.printerId.trim()
    ) return [];

    const q = query(collection(db, 'orders'), where('printerId', '==', printer.printerId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as OrderRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'orders');
  }
}

export async function getAllOrders(): Promise<OrderRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'orders'));
    return snap.docs.map((d) => d.data() as OrderRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'orders');
  }
}

export async function getOrderById(orderId: string): Promise<OrderRecord | null> {
  try {
    const snap = await getDoc(doc(db, 'orders', orderId));
    return snap.exists() ? (snap.data() as OrderRecord) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `orders/${orderId}`);
  }
}

const FORBIDDEN_CLIENT_ORDER_FIELDS = new Set([
  'paymentStatus',
  'subtotal',
  'tax',
  'shipping',
  'total',
  'currency',
  'qrCodeId',
  'printerId',
  'razorpayOrderId',
  'razorpayPaymentId',
  'razorpayAmountPaise',
  'razorpayCurrency',
  'razorpayOrderLock',
]);

export async function updateOrderWorkflow(params: {
  orderId: string;
  updates: Partial<OrderRecord>;
  actor: { uid: string; email?: string; role: UserRole };
  auditAction: string;
  auditDetails: string;
}): Promise<void> {
  const safeUpdates: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(params.updates)) {
    if (FORBIDDEN_CLIENT_ORDER_FIELDS.has(key)) {
      throw new Error(`Order field "${key}" must be updated via server Cloud Functions.`);
    }
    safeUpdates[key] = val;
  }
  if (
    safeUpdates.orderStatus === 'Payment Successful' ||
    safeUpdates.orderStatus === 'Refunded'
  ) {
    throw new Error(`Order status "${String(safeUpdates.orderStatus)}" must be updated via server payment verification or reconciliation.`);
  }

  try {
    await updateDoc(doc(db, 'orders', params.orderId), {
      ...safeUpdates,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: params.auditAction,
      targetCollection: 'orders',
      targetId: params.orderId,
      details: params.auditDetails,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `orders/${params.orderId}`);
  }
}

export async function dispatchOrderWithCourier(params: {
  order: OrderRecord;
  printerUid: string;
  actor?: { uid: string; email?: string; role: UserRole };
  courierName: string;
  trackingNumber: string;
  trackingUrl?: string;
  dispatchDate: string;
  notes?: string;
}): Promise<void> {
  const shippingId = `ship_${params.order.orderId}_${Date.now()}`;
  const effectivePrinterId = params.order.printerId || params.printerUid || 'admin_inhouse';
  const batch = writeBatch(db);
  batch.set(doc(db, 'shippingRecords', shippingId), {
    shippingId,
    orderId: params.order.orderId,
    uid: params.order.uid,
    printerId: effectivePrinterId,
    courierName: params.courierName,
    trackingNumber: params.trackingNumber,
    trackingUrl: params.trackingUrl || '',
    dispatchDate: params.dispatchDate,
    notes: params.notes || '',
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, 'orders', params.order.orderId), {
    orderStatus: 'Dispatched',
    courierName: params.courierName,
    trackingNumber: params.trackingNumber,
    trackingUrl: params.trackingUrl || '',
    dispatchDate: params.dispatchDate,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
    await recordAuditLog({
      actorUid: params.actor?.uid || params.printerUid,
      actorEmail: params.actor?.email,
      actorRole: params.actor?.role || 'PRINTER',
      action: 'ORDER_DISPATCHED',
      targetCollection: 'orders',
      targetId: params.order.orderId,
      details: `Dispatched via ${params.courierName} (${params.trackingNumber})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `orders/${params.order.orderId}`);
  }
}

// --- QR Codes ---
export async function getQrCodeById(qrCodeId: string): Promise<QrCodeRecord | null> {
  try {
    const snap = await getDoc(doc(db, 'qrCodes', qrCodeId));
    return snap.exists() ? (snap.data() as QrCodeRecord) : null;
  } catch {
    return null;
  }
}

export async function getAllQrCodes(): Promise<QrCodeRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'qrCodes'));
    return snap.docs.map((d) => d.data() as QrCodeRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'qrCodes');
  }
}

// --- Users, Admins & Printers ---
export async function getAllUsers(): Promise<UserRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map((d) => d.data() as UserRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}

export async function getUserById(uid: string): Promise<UserRecord | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as UserRecord) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }
}

export async function getAllPrinters(): Promise<PrinterRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'printers'));
    const records = snap.docs.map((d) => d.data() as PrinterRecord);

    // Role assignment creates a provisional printers/{authUid} record. Hide that placeholder
    // while a separately-created print facility with the same contact email is waiting to be linked.
    const visibleRecords = records.filter((record) => {
      const hasPrintAuthFacilityForSameEmail = records.some((candidate) =>
        candidate.printerId !== record.printerId &&
        candidate.printerId.startsWith('prt_') &&
        candidate.email.trim().toLowerCase() === record.email.trim().toLowerCase()
      );
      return !(record.uid === record.printerId && hasPrintAuthFacilityForSameEmail);
    });

    // During migration, the old Print Auth ID document and the linked UID document coexist.
    // Prefer the linked UID document, but return only one row per stable Print Auth ID.
    const byPrinterId = new Map<string, PrinterRecord>();
    for (const record of visibleRecords) {
      const current = byPrinterId.get(record.printerId);
      if (!current || (record.uid !== record.printerId && current.uid === current.printerId)) {
        byPrinterId.set(record.printerId, record);
      }
    }
    return Array.from(byPrinterId.values());
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'printers');
  }
}

export async function savePrinterRecord(
  printer: Omit<PrinterRecord, 'createdAt' | 'updatedAt'>,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  const documentId = printer.uid && printer.uid !== printer.printerId ? printer.uid : printer.printerId;
  const ref = doc(db, 'printers', documentId);
  const facilityRef = documentId !== printer.printerId ? doc(db, 'printers', printer.printerId) : null;
  const printerData: Omit<PrinterRecord, 'createdAt' | 'updatedAt'> = {
    printerId: printer.printerId,
    uid: printer.uid,
    businessName: printer.businessName,
    contactPerson: printer.contactPerson,
    email: printer.email,
    status: printer.status,
    ...(printer.phone !== undefined ? { phone: printer.phone } : {}),
    ...(printer.address !== undefined ? { address: printer.address } : {}),
    ...(printer.serviceAreas !== undefined ? { serviceAreas: printer.serviceAreas } : {}),
  };
  try {
    const snap = await getDoc(ref);
    const facilitySnap = facilityRef ? await getDoc(facilityRef) : null;
    const batch = writeBatch(db);
    const updatedAt = serverTimestamp();
    const updateData = {
      ...printerData,
      updatedAt,
    };

    if (snap.exists()) {
      batch.update(ref, updateData);
    } else {
      batch.set(ref, {
        ...printerData,
        createdAt: serverTimestamp(),
        updatedAt,
      });
    }

    if (facilityRef) {
      const stableFacilityData = {
        ...printerData,
        printerId: printer.printerId,
        uid: printer.printerId,
        updatedAt,
      };
      if (facilitySnap?.exists()) {
        batch.update(facilityRef, stableFacilityData);
      } else {
        batch.set(facilityRef, {
          ...stableFacilityData,
          createdAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'SAVE_PRINTER',
      targetCollection: 'printers',
      targetId: printer.printerId,
      details: `Printer ${printer.businessName} (${printer.status})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `printers/${printer.printerId}`);
  }
}

export async function updateUserRoleAndStatus(params: {
  targetUser: UserRecord;
  newRole: UserRole;
  newStatus: UserStatus;
  permissions?: UserRecord['permissions'];
  actor: { uid: string; email?: string; role: UserRole };
}): Promise<void> {
  const batch = writeBatch(db);
  const userRef = doc(db, 'users', params.targetUser.uid);
  const printerRef = doc(db, 'printers', params.targetUser.uid);
  const existingPrinterSnap =
    params.newRole === 'PRINTER' || params.targetUser.role === 'PRINTER'
      ? await getDoc(printerRef)
      : null;
  const existingPrinter = existingPrinterSnap?.exists()
    ? (existingPrinterSnap.data() as PrinterRecord)
    : null;
  const linkedFacilityRef =
    params.newRole === 'PRINTER' &&
    existingPrinter?.uid === params.targetUser.uid &&
    existingPrinter.printerId !== params.targetUser.uid
      ? doc(db, 'printers', existingPrinter.printerId)
      : null;
  const linkedFacilitySnap = linkedFacilityRef ? await getDoc(linkedFacilityRef) : null;

  batch.update(userRef, {
    role: params.newRole,
    status: params.newStatus,
    permissions: params.permissions || [],
    updatedAt: serverTimestamp(),
  });

  if (params.newRole === 'ADMIN' || params.newRole === 'SUPERADMIN') {
    batch.set(doc(db, 'admins', params.targetUser.uid), {
      uid: params.targetUser.uid,
      email: params.targetUser.email,
      role: params.newRole,
      permissions: params.permissions || [],
      active: params.newStatus === 'Active',
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.delete(doc(db, 'admins', params.targetUser.uid));
  }

  if (params.newRole === 'PRINTER') {
    const linkedPrinterId =
      existingPrinter?.uid === params.targetUser.uid && existingPrinter.printerId
        ? existingPrinter.printerId
        : params.targetUser.uid;
    const printerStatus: PrinterRecord['status'] =
      params.newStatus === 'Active'
        ? 'Active'
        : params.newStatus === 'Disabled'
          ? 'Disabled'
          : 'Blocked';

    const printerUpdate = {
      businessName:
        existingPrinter?.businessName ||
        params.targetUser.displayName ||
        params.targetUser.username ||
        'Print Partner',
      contactPerson:
        existingPrinter?.contactPerson ||
        params.targetUser.displayName ||
        params.targetUser.email,
      email: existingPrinter?.email || params.targetUser.email,
      phone: existingPrinter?.phone || params.targetUser.phone || '',
      ...(existingPrinter?.address ? { address: existingPrinter.address } : {}),
      status: printerStatus,
      serviceAreas: existingPrinter?.serviceAreas || ['All India'],
      updatedAt: serverTimestamp(),
    };

    batch.set(
      printerRef,
      {
        printerId: linkedPrinterId,
        uid: params.targetUser.uid,
        ...printerUpdate,
        createdAt: existingPrinter?.createdAt || serverTimestamp(),
      },
      { merge: true }
    );

    if (linkedFacilityRef) {
      const stableFacilityUpdate = {
        printerId: linkedPrinterId,
        uid: linkedPrinterId,
        ...printerUpdate,
      };
      if (linkedFacilitySnap?.exists()) {
        batch.update(linkedFacilityRef, stableFacilityUpdate);
      } else {
        batch.set(linkedFacilityRef, {
          ...stableFacilityUpdate,
          createdAt: serverTimestamp(),
        });
      }
    }
  }

  try {
    await batch.commit();
    await recordAuditLog({
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: 'UPDATE_USER_ROLE_STATUS',
      targetCollection: 'users',
      targetId: params.targetUser.uid,
      details: `Role=${params.newRole}, Status=${params.newStatus}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${params.targetUser.uid}`);
  }
}

export async function createManagedUserRecord(params: {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  status: UserStatus;
  actor: { uid: string; email?: string; role: UserRole };
}): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', params.uid), {
    uid: params.uid,
    username: params.email.split('@')[0],
    email: params.email,
    displayName: params.displayName,
    phone: params.phone || '',
    role: params.role,
    status: params.status,
    emailVerified: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (params.role === 'ADMIN' || params.role === 'SUPERADMIN') {
    batch.set(doc(db, 'admins', params.uid), {
      uid: params.uid,
      email: params.email,
      role: params.role,
      active: params.status === 'Active',
      permissions: [],
      updatedAt: serverTimestamp(),
    });
  }
  if (params.role === 'PRINTER') {
    batch.set(doc(db, 'printers', params.uid), {
      printerId: params.uid,
      uid: params.uid,
      businessName: params.displayName,
      contactPerson: params.displayName,
      email: params.email,
      phone: params.phone || '',
      status: params.status === 'Active' ? 'Active' : 'Blocked',
      serviceAreas: ['All India'],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  try {
    await batch.commit();
    await recordAuditLog({
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: 'CREATE_USER_RECORD',
      targetCollection: 'users',
      targetId: params.uid,
      details: `Created ${params.role} record for ${params.email}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${params.uid}`);
  }
}

// --- Payments, Shipping, Tickets, Email Templates, Audit Logs ---
export async function getAllPayments(): Promise<PaymentRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'payments'));
    return snap.docs.map((d) => d.data() as PaymentRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'payments');
  }
}

export async function getAllShippingRecords(): Promise<ShippingRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'shippingRecords'));
    return snap.docs.map((d) => d.data() as ShippingRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'shippingRecords');
  }
}

export async function getSupportTickets(uid?: string): Promise<SupportTicketRecord[]> {
  try {
    const constraints: QueryConstraint[] = uid ? [where('uid', '==', uid)] : [];
    const snap = await getDocs(query(collection(db, 'supportTickets'), ...constraints));
    return snap.docs.map((d) => d.data() as SupportTicketRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'supportTickets');
  }
}

export async function createSupportTicket(params: {
  uid: string;
  orderId?: string;
  subject: string;
  message: string;
  category: SupportTicketRecord['category'];
}): Promise<void> {
  const ticketId = `tkt_${Date.now()}`;
  try {
    await setDoc(doc(db, 'supportTickets', ticketId), {
      ticketId,
      uid: params.uid,
      orderId: params.orderId || '',
      subject: params.subject,
      message: params.message,
      category: params.category,
      status: 'Open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `supportTickets/${ticketId}`);
  }
}

export async function updateSupportTicket(
  ticketId: string,
  updates: Partial<SupportTicketRecord>
): Promise<void> {
  try {
    await updateDoc(doc(db, 'supportTickets', ticketId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `supportTickets/${ticketId}`);
  }
}

export async function getEmailTemplates(): Promise<EmailTemplateRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'emailTemplates'));
    if (snap.empty) return DEFAULT_EMAIL_TEMPLATES;
    return snap.docs.map((d) => d.data() as EmailTemplateRecord);
  } catch {
    return DEFAULT_EMAIL_TEMPLATES;
  }
}

export async function saveEmailTemplate(
  tpl: EmailTemplateRecord,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  try {
    await setDoc(doc(db, 'emailTemplates', tpl.templateId), {
      ...tpl,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'UPDATE_EMAIL_TEMPLATE',
      targetCollection: 'emailTemplates',
      targetId: tpl.templateId,
      details: `Updated template ${tpl.name}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `emailTemplates/${tpl.templateId}`);
  }
}

export type AuditLogPreset = '' | 'ALL' | 'LAST_24H' | 'LAST_7D' | 'LAST_30D' | 'CUSTOM';

export interface AuditLogFilterCriteria {
  preset: AuditLogPreset;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;   // YYYY-MM-DD
  role?: string;     // 'ALL' | UserRole
  action?: string;   // 'ALL' | action string
  keyword?: string;
  nowMs?: number;
}

export function filterAuditLogs(logs: AuditLogRecord[], criteria: AuditLogFilterCriteria): AuditLogRecord[] {
  const now = criteria.nowMs ?? Date.now();
  let minMs = 0;
  let maxMs = Number.POSITIVE_INFINITY;

  if (criteria.preset === 'LAST_24H') {
    minMs = now - 24 * 60 * 60 * 1000;
  } else if (criteria.preset === 'LAST_7D') {
    minMs = now - 7 * 24 * 60 * 60 * 1000;
  } else if (criteria.preset === 'LAST_30D') {
    minMs = now - 30 * 24 * 60 * 60 * 1000;
  } else if (criteria.preset === 'CUSTOM') {
    if (criteria.fromDate) {
      const parsedFrom = Date.parse(`${criteria.fromDate}T00:00:00`);
      if (Number.isFinite(parsedFrom)) minMs = parsedFrom;
    }
    if (criteria.toDate) {
      const parsedTo = Date.parse(`${criteria.toDate}T23:59:59.999`);
      if (Number.isFinite(parsedTo)) maxMs = parsedTo;
    }
  }

  const kw = (criteria.keyword || '').trim().toLowerCase();
  const roleFilter = criteria.role && criteria.role !== 'ALL' ? criteria.role : '';
  const actionFilter = criteria.action && criteria.action !== 'ALL' ? criteria.action : '';

  return logs.filter((l) => {
    const tsMs = extractTimestampMs(l.createdAt);
    if (minMs > 0 || maxMs < Number.POSITIVE_INFINITY) {
      if (!tsMs || tsMs < minMs || tsMs > maxMs) return false;
    }
    if (roleFilter && l.actorRole !== roleFilter) return false;
    if (actionFilter && l.action !== actionFilter) return false;
    if (kw) {
      const hay = [
        l.action,
        l.actorEmail || '',
        l.actorUid,
        l.actorRole,
        l.targetCollection,
        l.targetId,
        l.details || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

export async function getAuditLogs(max = 300): Promise<AuditLogRecord[]> {
  try {
    const q = query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(max));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as AuditLogRecord)
      .sort((a, b) => extractTimestampMs(b.createdAt) - extractTimestampMs(a.createdAt));
  } catch {
    try {
      const snap = await getDocs(collection(db, 'auditLogs'));
      return snap.docs
        .map((d) => d.data() as AuditLogRecord)
        .sort((a, b) => extractTimestampMs(b.createdAt) - extractTimestampMs(a.createdAt))
        .slice(0, max);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'auditLogs');
    }
  }
}

export async function sendAndLogTransactionalEmail(params: {
  uid: string;
  to: string;
  templateId: string;
  variables: Record<string, string>;
}): Promise<{ delivered: boolean; mode: string }> {
  const templates = await getEmailTemplates();
  const tpl = templates.find((t) => t.templateId === params.templateId) || DEFAULT_EMAIL_TEMPLATES[3];
  let subject = tpl.subject;
  let html = tpl.htmlBody;
  for (const [k, v] of Object.entries(params.variables)) {
    subject = subject.replaceAll(`{{${k}}}`, v);
    html = html.replaceAll(`{{${k}}}`, v);
  }

  let delivered = false;
  let mode = 'unconfigured';
  try {
    const resp = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: params.to, subject, html }),
    });
    const data = (await resp.json()) as { delivered?: boolean; mode?: string };
    delivered = Boolean(data.delivered);
    mode = data.mode || 'unconfigured';
  } catch {
    mode = 'error';
  }

  const notifId = `ntf_${Date.now()}`;
  const notif: NotificationRecord = {
    notificationId: notifId,
    uid: params.uid,
    title: subject.slice(0, 150),
    message: `Email notification (${tpl.name}) -> ${params.to} [${delivered ? 'Sent via Resend' : 'Queued (Resend API key required)'}]`,
    channel: 'email',
    deliveryStatus: delivered ? 'Sent' : 'ConfigRequired',
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'notifications', notifId), notif);
  } catch {
    // Non-blocking notification log
  }

  return { delivered, mode };
}

// --- Shop Categories & Products ---
export async function getShopCategories(includeInactive = false): Promise<ShopCategoryRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'shopCategories'));
    const list = snap.empty
      ? DEFAULT_SHOP_CATEGORIES
      : snap.docs.map((d) => d.data() as ShopCategoryRecord);
    const sorted = [...list].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.name.localeCompare(b.name));
    return includeInactive ? sorted : sorted.filter((c) => c.active);
  } catch {
    const sorted = [...DEFAULT_SHOP_CATEGORIES].sort((a, b) => a.sortOrder - b.sortOrder);
    return includeInactive ? sorted : sorted.filter((c) => c.active);
  }
}

export async function saveShopCategory(
  cat: ShopCategoryRecord,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  const path = `shopCategories/${cat.categoryId}`;
  try {
    await setDoc(doc(db, 'shopCategories', cat.categoryId), {
      categoryId: cat.categoryId,
      name: cat.name.trim(),
      slug: sanitizeSlug(cat.slug || cat.name) || cat.categoryId,
      description: (cat.description || '').trim(),
      active: Boolean(cat.active),
      sortOrder: Number(cat.sortOrder) || 1,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'SAVE_SHOP_CATEGORY',
      targetCollection: 'shopCategories',
      targetId: cat.categoryId,
      details: `Saved shop category "${cat.name}" (active=${cat.active})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteShopCategory(
  categoryId: string,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  try {
    const existingSnap = await getDocs(collection(db, 'shopCategories'));
    if (existingSnap.empty) {
      const batch = writeBatch(db);
      for (const def of DEFAULT_SHOP_CATEGORIES) {
        if (def.categoryId !== categoryId) {
          batch.set(doc(db, 'shopCategories', def.categoryId), {
            ...def,
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    } else {
      await deleteDoc(doc(db, 'shopCategories', categoryId));
    }
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'DELETE_SHOP_CATEGORY',
      targetCollection: 'shopCategories',
      targetId: categoryId,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `shopCategories/${categoryId}`);
  }
}

export async function getShopProducts(includeHidden = false): Promise<ShopProductRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'shopProducts'));
    const list = snap.empty
      ? DEFAULT_SHOP_PRODUCTS
      : snap.docs.map((d) => d.data() as ShopProductRecord);
    const sorted = [...list].sort(
      (a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.name.localeCompare(b.name)
    );
    return includeHidden ? sorted : sorted.filter((p) => p.visibleOnShop);
  } catch {
    const sorted = [...DEFAULT_SHOP_PRODUCTS].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
    return includeHidden ? sorted : sorted.filter((p) => p.visibleOnShop);
  }
}

export async function saveShopProduct(
  product: ShopProductRecord,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  const path = `shopProducts/${product.productId}`;
  try {
    const existingSnap = await getDocs(collection(db, 'shopProducts'));
    if (existingSnap.empty) {
      const batch = writeBatch(db);
      for (const def of DEFAULT_SHOP_PRODUCTS) {
        batch.set(doc(db, 'shopProducts', def.productId), {
          ...def,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    await setDoc(doc(db, 'shopProducts', product.productId), {
      productId: product.productId,
      name: product.name.trim(),
      slug: sanitizeSlug(product.slug || product.name) || product.productId,
      categoryId: product.categoryId,
      categoryName: product.categoryName || '',
      shortDescription: (product.shortDescription || '').trim(),
      description: (product.description || '').trim(),
      features: (product.features || []).map((f) => f.trim()).filter(Boolean).slice(0, 20),
      priceInr: Math.max(0, Number(product.priceInr) || 0),
      compareAtPriceInr: Math.max(0, Number(product.compareAtPriceInr) || 0),
      cardType: (product.cardType || product.categoryName || 'Smart Tag').trim(),
      imageDataUrl: product.imageDataUrl || '',
      badgeText: (product.badgeText || '').trim(),
      visibleOnShop: Boolean(product.visibleOnShop),
      featured: Boolean(product.featured),
      inStock: product.inStock !== false,
      sortOrder: Number(product.sortOrder) || 1,
      createdAt: product.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'SAVE_SHOP_PRODUCT',
      targetCollection: 'shopProducts',
      targetId: product.productId,
      details: `Saved product "${product.name}" (₹${product.priceInr}, visibleOnShop=${product.visibleOnShop})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteShopProduct(
  productId: string,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  try {
    const existingSnap = await getDocs(collection(db, 'shopProducts'));
    if (existingSnap.empty) {
      const batch = writeBatch(db);
      for (const def of DEFAULT_SHOP_PRODUCTS) {
        if (def.productId !== productId) {
          batch.set(doc(db, 'shopProducts', def.productId), {
            ...def,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    } else {
      await deleteDoc(doc(db, 'shopProducts', productId));
    }
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'DELETE_SHOP_PRODUCT',
      targetCollection: 'shopProducts',
      targetId: productId,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `shopProducts/${productId}`);
  }
}

export async function seedInitialShopIfEmpty(actor: {
  uid: string;
  email?: string;
  role: UserRole;
}): Promise<void> {
  if (actor.role !== 'SUPERADMIN' && actor.role !== 'ADMIN') return;
  try {
    const catSnap = await getDocs(collection(db, 'shopCategories'));
    if (catSnap.empty) {
      const batch = writeBatch(db);
      for (const c of DEFAULT_SHOP_CATEGORIES) {
        batch.set(doc(db, 'shopCategories', c.categoryId), { ...c, updatedAt: serverTimestamp() });
      }
      await batch.commit();
    }
    const prodSnap = await getDocs(collection(db, 'shopProducts'));
    if (prodSnap.empty) {
      const batch = writeBatch(db);
      for (const p of DEFAULT_SHOP_PRODUCTS) {
        batch.set(doc(db, 'shopProducts', p.productId), {
          ...p,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } catch {
    // ignore if already present
  }
}

export async function seedInitialCatalogIfEmpty(actor: {
  uid: string;
  email?: string;
  role: UserRole;
}): Promise<void> {
  if (actor.role !== 'SUPERADMIN' && actor.role !== 'ADMIN') return;
  try {
    const tplSnap = await getDocs(collection(db, 'cardTemplates'));
    if (tplSnap.empty) {
      const batch = writeBatch(db);
      for (const t of DEFAULT_CARD_TEMPLATES) {
        batch.set(doc(db, 'cardTemplates', t.templateId), {
          ...toFirestoreCardTemplate(t),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
    await seedInitialShopIfEmpty(actor);
    if (actor.role === 'SUPERADMIN') {
      const settingsSnap = await getDoc(doc(db, 'appSettings', 'global'));
      if (!settingsSnap.exists()) {
        await setDoc(doc(db, 'appSettings', 'global'), {
          ...DEFAULT_APP_SETTINGS,
          updatedAt: serverTimestamp(),
        });
      }
      const emailSnap = await getDocs(collection(db, 'emailTemplates'));
      if (emailSnap.empty) {
        const batch = writeBatch(db);
        for (const e of DEFAULT_EMAIL_TEMPLATES) {
          batch.set(doc(db, 'emailTemplates', e.templateId), { ...e, updatedAt: serverTimestamp() });
        }
        await batch.commit();
      }
    }
  } catch {
    // ignore seed errors if already present
  }
}

export function formatOrderStatusLabel(status: OrderStatus): string {
  return status;
}

export const RESETTABLE_OPERATIONAL_COLLECTIONS = [
  'orders',
  'shippingRecords',
  'cardDesigns',
  'supportTickets',
  'notifications',
  'printers',
  'profiles',
  'publicProfiles',
] as const;

export const RETAINED_FACTORY_RESET_COLLECTIONS = [
  {
    collection: 'payments',
    reason: 'Server-only payment ledger is protected from browser deletion and retained for reconciliation.',
  },
  {
    collection: 'qrCodes',
    reason: 'Server-only QR code artifacts are protected from browser deletion.',
  },
  {
    collection: 'auditLogs',
    reason: 'Security and administrative audit logs are preserved unconditionally.',
  },
  {
    collection: 'authUsersAndStorage',
    reason: 'Firebase Authentication logins and Storage QR assets remain intact.',
  },
] as const;

export interface ApplicationResetOptions {
  restoreDefaultCatalog?: boolean;
}

export interface ApplicationResetResult {
  deletedCounts: Record<string, number>;
  retainedCollections: Array<{ collection: string; reason: string }>;
  localDraftsCleared: number;
  totalDeleted: number;
  errors: Array<{ collection: string; message: string }>;
}

async function deleteCollectionDocsInBatches(
  collectionName: string,
  shouldDelete: (docId: string) => boolean = () => true
): Promise<number> {
  const snap = await getDocs(collection(db, collectionName));
  const refsToDelete = snap.docs.filter((d) => shouldDelete(d.id)).map((d) => d.ref);
  if (refsToDelete.length === 0) return 0;

  const CHUNK_SIZE = 400;
  for (let i = 0; i < refsToDelete.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const ref of refsToDelete.slice(i, i + CHUNK_SIZE)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
  return refsToDelete.length;
}

export async function resetApplicationToFreshBlank(
  actor: { uid: string; email?: string; role: UserRole },
  options: ApplicationResetOptions = {}
): Promise<ApplicationResetResult> {
  if (actor.role !== 'SUPERADMIN') {
    throw new Error('Only SuperAdmin accounts can reset all application data.');
  }

  const restoreDefaultCatalog = options.restoreDefaultCatalog ?? true;

  const deletedCounts: Record<string, number> = {};
  const errors: Array<{ collection: string; message: string }> = [];

  for (const col of RESETTABLE_OPERATIONAL_COLLECTIONS) {
    try {
      deletedCounts[col] = await deleteCollectionDocsInBatches(col);
    } catch (err) {
      deletedCounts[col] = 0;
      errors.push({
        collection: col,
        message: err instanceof Error ? err.message : 'Failed to clear collection',
      });
    }
  }

  // Remove secondary admin and user records while preserving the active SuperAdmin account
  for (const accountCol of ['admins', 'users'] as const) {
    try {
      deletedCounts[accountCol] = await deleteCollectionDocsInBatches(
        accountCol,
        (docId) => docId !== actor.uid
      );
    } catch (err) {
      deletedCounts[accountCol] = 0;
      errors.push({
        collection: accountCol,
        message: err instanceof Error ? err.message : 'Failed to clear secondary accounts',
      });
    }
  }

  if (restoreDefaultCatalog) {
    for (const catalogCol of ['cardTemplates', 'emailTemplates', 'appSettings', 'shopCategories', 'shopProducts'] as const) {
      try {
        deletedCounts[catalogCol] = await deleteCollectionDocsInBatches(catalogCol);
      } catch (err) {
        deletedCounts[catalogCol] = 0;
        errors.push({
          collection: catalogCol,
          message: err instanceof Error ? err.message : 'Failed to reset catalog collection',
        });
      }
    }

    try {
      const seedBatch = writeBatch(db);
      for (const tpl of DEFAULT_CARD_TEMPLATES) {
        seedBatch.set(doc(db, 'cardTemplates', tpl.templateId), {
          ...toFirestoreCardTemplate(tpl),
          updatedAt: serverTimestamp(),
        });
      }
      for (const emailTpl of DEFAULT_EMAIL_TEMPLATES) {
        seedBatch.set(doc(db, 'emailTemplates', emailTpl.templateId), {
          ...emailTpl,
          updatedAt: serverTimestamp(),
        });
      }
      for (const cat of DEFAULT_SHOP_CATEGORIES) {
        seedBatch.set(doc(db, 'shopCategories', cat.categoryId), {
          ...cat,
          updatedAt: serverTimestamp(),
        });
      }
      for (const prod of DEFAULT_SHOP_PRODUCTS) {
        seedBatch.set(doc(db, 'shopProducts', prod.productId), {
          ...prod,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      seedBatch.set(doc(db, 'appSettings', 'global'), {
        ...DEFAULT_APP_SETTINGS,
        updatedAt: serverTimestamp(),
      });
      await seedBatch.commit();
    } catch (err) {
      errors.push({
        collection: 'catalogDefaults',
        message: err instanceof Error ? err.message : 'Failed to restore factory defaults',
      });
    }
  }

  const localDraftsCleared = clearAllLocalStudioDrafts();
  const totalDeleted = Object.values(deletedCounts).reduce((sum, count) => sum + count, 0);
  const retainedCollections = RETAINED_FACTORY_RESET_COLLECTIONS.map((item) => ({ ...item }));

  await recordAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'APPLICATION_FACTORY_RESET',
    targetCollection: 'system',
    targetId: 'operational_reset',
    details: `Cleared ${totalDeleted} operational Firestore records and ${localDraftsCleared} local drafts; retained payments, qrCodes, and auditLogs.`,
  });

  return {
    deletedCounts,
    retainedCollections,
    localDraftsCleared,
    totalDeleted,
    errors,
  };
}
