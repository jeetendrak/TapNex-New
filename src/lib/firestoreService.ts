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
import { generateHighResQrArtwork } from './qrArtwork';
import { sanitizeRichBioHtml } from './richText';
import { clearAllLocalStudioDrafts } from './studioDraft';
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
  const updatedProfile: ProfileRecord = { ...profile, slug: cleanSlug };

  let existingPaymentConfirmed = Boolean(profile.paymentConfirmed);
  let existingPaymentCompletedAt = profile.paymentCompletedAt || '';
  let existingLastPaidOrderId = '';
  let existingAdminApproved = Boolean(profile.adminApproved);
  let existingAdminApprovedAt = profile.adminApprovedAt || '';
  let existingAdminApprovedBy = profile.adminApprovedBy || '';
  let existingAdminDisabled = Boolean(profile.adminDisabled);
  try {
    const existingPub = await getDoc(doc(db, 'publicProfiles', cleanSlug));
    if (existingPub.exists()) {
      const pubData = existingPub.data() as PublicProfileRecord;
      existingPaymentConfirmed = existingPaymentConfirmed || Boolean(pubData.paymentConfirmed);
      existingPaymentCompletedAt = existingPaymentCompletedAt || pubData.paymentCompletedAt || '';
      existingLastPaidOrderId = pubData.lastPaidOrderId || '';
      if (!existingAdminApproved && pubData.adminApproved) {
        existingAdminApproved = true;
        existingAdminApprovedAt = pubData.adminApprovedAt || '';
        existingAdminApprovedBy = pubData.adminApprovedBy || '';
      }
      if (!existingAdminDisabled && pubData.adminDisabled) {
        existingAdminDisabled = true;
      }
    } else if (previousSlug && previousSlug !== cleanSlug) {
      const prevPub = await getDoc(doc(db, 'publicProfiles', previousSlug));
      if (prevPub.exists()) {
        const pubData = prevPub.data() as PublicProfileRecord;
        existingPaymentConfirmed = existingPaymentConfirmed || Boolean(pubData.paymentConfirmed);
        existingPaymentCompletedAt = existingPaymentCompletedAt || pubData.paymentCompletedAt || '';
        existingLastPaidOrderId = pubData.lastPaidOrderId || '';
        if (!existingAdminApproved && pubData.adminApproved) {
          existingAdminApproved = true;
          existingAdminApprovedAt = pubData.adminApprovedAt || '';
          existingAdminApprovedBy = pubData.adminApprovedBy || '';
        }
        if (!existingAdminDisabled && pubData.adminDisabled) {
          existingAdminDisabled = true;
        }
      }
    }
  } catch {
    // ignore read fallback
  }

  if (!existingPaymentConfirmed && profile.uid && profile.profileId) {
    try {
      const ownerOrders = await getCustomerOrders(profile.uid);
      const paidOrder = ownerOrders.find(
        (o) =>
          (o.profileId === profile.profileId || o.profileSlug === cleanSlug || (previousSlug && o.profileSlug === previousSlug)) &&
          (o.paymentStatus === 'Verified' || o.paymentStatus === 'Completed' || o.orderStatus === 'Delivered')
      );
      if (paidOrder) {
        existingPaymentConfirmed = true;
        existingLastPaidOrderId = paidOrder.orderId;
      }
    } catch {
      // ignore if caller lacks order list access
    }
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
      ...(existingPaymentConfirmed ? { paymentConfirmed: true } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (previousSlug && previousSlug !== cleanSlug) {
    batch.delete(doc(db, 'publicProfiles', previousSlug));
  }

  const normalizedForPublic: ProfileRecord = {
    ...updatedProfile,
    paymentConfirmed: existingPaymentConfirmed,
    ...(existingPaymentCompletedAt ? { paymentCompletedAt: existingPaymentCompletedAt } : {}),
    adminApproved: existingAdminApproved,
    adminApprovedAt: existingAdminApprovedAt,
    adminApprovedBy: existingAdminApprovedBy,
    adminDisabled: existingAdminDisabled,
  };

  batch.set(doc(db, 'publicProfiles', cleanSlug), {
    ...buildSanitizedPublicProfile(normalizedForPublic, inactiveMessage),
    paymentConfirmed: existingPaymentConfirmed,
    ...(existingPaymentCompletedAt ? { paymentCompletedAt: existingPaymentCompletedAt } : {}),
    adminDisabled: existingAdminDisabled,
    ...(existingAdminApproved
      ? {
          adminApproved: true,
          ...(existingAdminApprovedAt ? { adminApprovedAt: existingAdminApprovedAt } : {}),
          ...(existingAdminApprovedBy ? { adminApprovedBy: existingAdminApprovedBy } : {}),
        }
      : { adminApproved: false }),
    ...(existingLastPaidOrderId ? { lastPaidOrderId: existingLastPaidOrderId } : {}),
    updatedAt: serverTimestamp(),
  });

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
  let existingPaymentConfirmed = Boolean(params.profile.paymentConfirmed);
  let existingPaymentCompletedAt = params.profile.paymentCompletedAt || '';
  let existingLastPaidOrderId = '';
  try {
    const existingPub = await getDoc(doc(db, 'publicProfiles', params.profile.slug));
    if (existingPub.exists()) {
      const pubData = existingPub.data() as PublicProfileRecord;
      existingPaymentConfirmed = existingPaymentConfirmed || Boolean(pubData.paymentConfirmed);
      existingPaymentCompletedAt = existingPaymentCompletedAt || pubData.paymentCompletedAt || '';
      existingLastPaidOrderId = pubData.lastPaidOrderId || '';
    }
  } catch {
    // ignore read fallback
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'profiles', params.profile.profileId), {
    isPublic: params.isPublic,
    adminDisabled,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'publicProfiles', params.profile.slug), {
    ...buildSanitizedPublicProfile(updated, params.inactiveMessage),
    paymentConfirmed: existingPaymentConfirmed,
    ...(existingPaymentCompletedAt ? { paymentCompletedAt: existingPaymentCompletedAt } : {}),
    adminDisabled,
    ...(params.profile.adminApproved
      ? {
          adminApproved: true,
          ...(params.profile.adminApprovedAt ? { adminApprovedAt: params.profile.adminApprovedAt } : {}),
          ...(params.profile.adminApprovedBy ? { adminApprovedBy: params.profile.adminApprovedBy } : {}),
        }
      : {}),
    ...(existingLastPaidOrderId ? { lastPaidOrderId: existingLastPaidOrderId } : {}),
    updatedAt: serverTimestamp(),
  });
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

export async function markProfilePaymentCompleted(params: {
  profile: ProfileRecord;
  completed?: boolean;
  reference?: string;
  actor: { uid: string; email?: string; role: UserRole };
  inactiveMessage?: string;
}): Promise<ProfileRecord> {
  const completed = params.completed ?? true;
  const completedAt = completed ? new Date().toISOString() : '';
  const paymentRef = (params.reference || '').trim().slice(0, 128);
  const updated: ProfileRecord = {
    ...params.profile,
    isPublic: completed ? true : params.profile.isPublic,
    paymentConfirmed: completed,
    paymentCompletedAt: completedAt,
    paymentReference: paymentRef,
  };

  let existingLastPaidOrderId = '';
  try {
    const existingPub = await getDoc(doc(db, 'publicProfiles', params.profile.slug));
    if (existingPub.exists()) {
      const pubData = existingPub.data() as PublicProfileRecord;
      existingLastPaidOrderId = pubData.lastPaidOrderId || '';
    }
  } catch {
    // ignore read fallback
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'profiles', params.profile.profileId), {
    isPublic: updated.isPublic,
    paymentConfirmed: completed,
    paymentCompletedAt: completedAt,
    paymentReference: paymentRef,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'publicProfiles', params.profile.slug), {
    ...buildSanitizedPublicProfile(updated, params.inactiveMessage),
    paymentConfirmed: completed,
    paymentCompletedAt: completedAt,
    adminDisabled: Boolean(updated.adminDisabled),
    ...(updated.adminApproved
      ? {
          adminApproved: true,
          ...(updated.adminApprovedAt ? { adminApprovedAt: updated.adminApprovedAt } : {}),
          ...(updated.adminApprovedBy ? { adminApprovedBy: updated.adminApprovedBy } : {}),
        }
      : { adminApproved: false }),
    ...(existingLastPaidOrderId ? { lastPaidOrderId: existingLastPaidOrderId } : {}),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await recordAuditLog({
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: completed ? 'MARK_PROFILE_PAYMENT_COMPLETED' : 'REVOKE_PROFILE_PAYMENT_STATUS',
      targetCollection: 'profiles',
      targetId: params.profile.profileId,
      details: `${completed ? 'Marked payment completed' : 'Cleared payment completion'} for /p/${params.profile.slug}${paymentRef ? ` (Ref: ${paymentRef})` : ''}`,
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

  let existingPaymentConfirmed = Boolean(params.profile.paymentConfirmed);
  let existingPaymentCompletedAt = params.profile.paymentCompletedAt || '';
  let existingLastPaidOrderId = '';
  try {
    const existingPub = await getDoc(doc(db, 'publicProfiles', params.profile.slug));
    if (existingPub.exists()) {
      const pubData = existingPub.data() as PublicProfileRecord;
      existingPaymentConfirmed = existingPaymentConfirmed || Boolean(pubData.paymentConfirmed);
      existingPaymentCompletedAt = existingPaymentCompletedAt || pubData.paymentCompletedAt || '';
      existingLastPaidOrderId = pubData.lastPaidOrderId || '';
    }
  } catch {
    // ignore read fallback
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'profiles', params.profile.profileId), {
    isPublic: updated.isPublic,
    adminDisabled: Boolean(updated.adminDisabled),
    adminApproved: params.approved,
    adminApprovedAt: approvedAt,
    adminApprovedBy: approvedBy,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'publicProfiles', params.profile.slug), {
    ...buildSanitizedPublicProfile(updated, params.inactiveMessage),
    paymentConfirmed: existingPaymentConfirmed,
    ...(existingPaymentCompletedAt ? { paymentCompletedAt: existingPaymentCompletedAt } : {}),
    adminDisabled: Boolean(updated.adminDisabled),
    adminApproved: params.approved,
    adminApprovedAt: approvedAt,
    adminApprovedBy: approvedBy,
    ...(existingLastPaidOrderId ? { lastPaidOrderId: existingLastPaidOrderId } : {}),
    updatedAt: serverTimestamp(),
  });

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
): Promise<void> {
  const ref = doc(db, 'cardDesigns', design.designId);
  const approvedAt = design.approved ? design.approvedAt || new Date().toISOString() : '';
  const cardTechnology =
    design.cardTechnology || (design.frontDesign?.showNfcIcon ? 'qr_smart' : 'qr_only');
  const payload = {
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

export async function finalizeVerifiedOrderPayment(params: {
  orderId: string;
  uid: string;
  profileSlug?: string;
  gateway: PaymentRecord['gateway'];
  gatewayOrderId: string;
  gatewayPaymentId: string;
  amount: number;
  qrArtifact: {
    targetUrl: string;
    svgContent: string;
    pngDataUrl: string;
  };
}): Promise<void> {
  const batch = writeBatch(db);
  const paymentRef = doc(db, 'payments', params.orderId);
  const qrRef = doc(db, 'qrCodes', params.orderId);
  const orderRef = doc(db, 'orders', params.orderId);

  batch.set(paymentRef, {
    paymentId: params.orderId,
    orderId: params.orderId,
    uid: params.uid,
    gateway: params.gateway,
    gatewayOrderId: params.gatewayOrderId,
    gatewayPaymentId: params.gatewayPaymentId,
    signatureVerified: true,
    amount: params.amount,
    currency: 'INR',
    status: 'Verified',
    verifiedAt: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });

  batch.set(qrRef, {
    qrCodeId: params.orderId,
    uid: params.uid,
    orderId: params.orderId,
    printerId: '',
    targetUrl: params.qrArtifact.targetUrl,
    svgContent: params.qrArtifact.svgContent,
    pngDataUrl: params.qrArtifact.pngDataUrl,
    storagePath: `qrCodes/${params.orderId}/qr.png`,
    format: 'PNG_SVG',
    qrType: 'CUSTOMER_ORDER',
    version: 1,
    createdBy: params.uid,
    createdAt: serverTimestamp(),
  });

  batch.update(orderRef, {
    paymentStatus: 'Verified',
    orderStatus: 'Payment Successful',
    qrCodeId: params.orderId,
    printFileReady: true,
    updatedAt: serverTimestamp(),
  });

  if (params.profileSlug) {
    batch.set(
      doc(db, 'publicProfiles', params.profileSlug),
      {
        paymentConfirmed: true,
        lastPaidOrderId: params.orderId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `orders/${params.orderId}`);
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
    const q = query(collection(db, 'orders'), where('printerId', '==', printerUid));
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

export async function unlockProfileForOrder(
  order: OrderRecord,
  actorRole: UserRole
): Promise<boolean> {
  const isUnlockedOrder =
    order.orderStatus === 'Delivered' ||
    order.paymentStatus === 'Verified' ||
    order.paymentStatus === 'Completed';
  if (!isUnlockedOrder) return false;

  const isPrivileged = actorRole === 'ADMIN' || actorRole === 'SUPERADMIN';
  let linkedProfile: ProfileRecord | null = null;
  if (order.profileId && actorRole !== 'PRINTER') {
    linkedProfile = await getProfileById(order.profileId);
    if (linkedProfile && (!linkedProfile.paymentConfirmed || !linkedProfile.isPublic) && !linkedProfile.adminDisabled) {
      await updateDoc(doc(db, 'profiles', linkedProfile.profileId), {
        paymentConfirmed: true,
        isPublic: true,
        updatedAt: serverTimestamp(),
      }).catch(() => null);
    }
  }

  const targetSlugs = new Set<string>();
  if (order.profileSlug) {
    const s = sanitizeSlug(order.profileSlug);
    if (s) targetSlugs.add(s);
  }
  if (linkedProfile?.slug) {
    const s = sanitizeSlug(linkedProfile.slug);
    if (s) targetSlugs.add(s);
  }

  let updatedAny = false;
  for (const targetSlug of targetSlugs) {
    const pubRef = doc(db, 'publicProfiles', targetSlug);
    const pubSnap = await getDoc(pubRef).catch(() => null);
    if (pubSnap && pubSnap.exists()) {
      const pubData = pubSnap.data() as PublicProfileRecord;
      if (pubData.adminDisabled) continue;
      if (!pubData.paymentConfirmed || !pubData.isPublic || pubData.lastPaidOrderId !== order.orderId) {
        await updateDoc(pubRef, {
          paymentConfirmed: true,
          isPublic: true,
          lastPaidOrderId: order.orderId,
          updatedAt: serverTimestamp(),
        }).catch(() => null);
        updatedAny = true;
      }
    } else if (linkedProfile && (isPrivileged || actorRole === 'USER')) {
      if (linkedProfile.adminDisabled) continue;
      await setDoc(pubRef, {
        ...buildSanitizedPublicProfile({ ...linkedProfile, slug: targetSlug, isPublic: true }),
        paymentConfirmed: true,
        isPublic: true,
        adminDisabled: false,
        lastPaidOrderId: order.orderId,
        updatedAt: serverTimestamp(),
      }).catch(() => null);
      updatedAny = true;
    }
  }
  return updatedAny;
}

export async function reconcileDeliveredOrdersToProfiles(
  orders: OrderRecord[],
  actorRole: UserRole,
  profiles?: ProfileRecord[]
): Promise<boolean> {
  const unlockedOrders = orders.filter(
    (o) =>
      o.orderStatus === 'Delivered' ||
      o.paymentStatus === 'Verified' ||
      o.paymentStatus === 'Completed'
  );
  if (unlockedOrders.length === 0) return false;

  const profileById = new Map<string, ProfileRecord>();
  if (profiles) {
    for (const p of profiles) {
      profileById.set(p.profileId, p);
    }
  }

  const seenProfileKeys = new Set<string>();
  let anyReconciled = false;
  for (const ord of unlockedOrders) {
    const key = ord.profileId || ord.profileSlug || ord.orderId;
    if (seenProfileKeys.has(key)) continue;
    seenProfileKeys.add(key);

    const knownProfile = ord.profileId ? profileById.get(ord.profileId) : undefined;
    if (knownProfile?.adminDisabled) continue;
    if (knownProfile && knownProfile.paymentConfirmed && knownProfile.isPublic && ord.profileSlug) {
      // Still verify publicProfiles doc isn't missing paymentConfirmed/isPublic if needed
      const pubSnap = await getDoc(doc(db, 'publicProfiles', sanitizeSlug(knownProfile.slug || ord.profileSlug))).catch(() => null);
      if (pubSnap?.exists()) {
        const pub = pubSnap.data() as PublicProfileRecord;
        if ((pub.paymentConfirmed && pub.isPublic) || pub.adminDisabled) continue;
      }
    }

    const changed = await unlockProfileForOrder(ord, actorRole).catch(() => false);
    if (changed) anyReconciled = true;
  }
  return anyReconciled;
}

export async function updateOrderWorkflow(params: {
  orderId: string;
  updates: Partial<OrderRecord>;
  actor: { uid: string; email?: string; role: UserRole };
  auditAction: string;
  auditDetails: string;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'orders', params.orderId), {
      ...params.updates,
      updatedAt: serverTimestamp(),
    });
    if (params.updates.printerId) {
      await updateDoc(doc(db, 'qrCodes', params.orderId), {
        printerId: params.updates.printerId,
      }).catch(() => null);
    }
    if (
      params.updates.orderStatus === 'Delivered' ||
      params.updates.paymentStatus === 'Verified' ||
      params.updates.paymentStatus === 'Completed'
    ) {
      const ordSnap = await getDoc(doc(db, 'orders', params.orderId)).catch(() => null);
      if (ordSnap?.exists()) {
        await unlockProfileForOrder(ordSnap.data() as OrderRecord, params.actor.role).catch(() => null);
      }
    }
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

export async function updateOrderAndPaymentStatus(params: {
  order: OrderRecord;
  paymentStatus: PaymentStatus;
  orderStatus?: OrderStatus;
  actor: { uid: string; email?: string; role: UserRole };
}): Promise<void> {
  const batch = writeBatch(db);
  const orderRef = doc(db, 'orders', params.order.orderId);
  const nextOrderStatus = params.orderStatus || params.order.orderStatus;

  batch.update(orderRef, {
    paymentStatus: params.paymentStatus,
    orderStatus: nextOrderStatus,
    updatedAt: serverTimestamp(),
  });

  const paymentRef = doc(db, 'payments', params.order.orderId);
  try {
    const paySnap = await getDoc(paymentRef);
    const isPaymentDone = params.paymentStatus === 'Completed' || params.paymentStatus === 'Verified';
    const isUnlocked = isPaymentDone || nextOrderStatus === 'Delivered';
    if (paySnap.exists()) {
      batch.update(paymentRef, {
        status: params.paymentStatus,
        signatureVerified: isPaymentDone,
        verifiedAt: isPaymentDone ? new Date().toISOString() : '',
      });
    } else {
      batch.set(paymentRef, {
        paymentId: params.order.orderId,
        orderId: params.order.orderId,
        uid: params.order.uid,
        gateway: 'razorpay_sandbox',
        gatewayOrderId: `manual_${params.order.orderNumber}`,
        gatewayPaymentId: '',
        signatureVerified: isPaymentDone,
        amount: params.order.total,
        currency: 'INR',
        status: params.paymentStatus,
        verifiedAt: isPaymentDone ? new Date().toISOString() : '',
        createdAt: serverTimestamp(),
      });
    }
    const targetSlugs = new Set<string>();
    if (params.order.profileSlug) {
      targetSlugs.add(sanitizeSlug(params.order.profileSlug));
    }
    let linkedProfile: ProfileRecord | null = null;
    if (params.order.profileId) {
      const profSnap = await getDoc(doc(db, 'profiles', params.order.profileId));
      if (profSnap.exists()) {
        linkedProfile = profSnap.data() as ProfileRecord;
        if (linkedProfile.slug) {
          targetSlugs.add(sanitizeSlug(linkedProfile.slug));
        }
        if (isUnlocked && !linkedProfile.adminDisabled) {
          batch.update(doc(db, 'profiles', linkedProfile.profileId), {
            paymentConfirmed: true,
            isPublic: true,
            updatedAt: serverTimestamp(),
          });
        } else if (!isUnlocked && linkedProfile.paymentConfirmed) {
          batch.update(doc(db, 'profiles', linkedProfile.profileId), {
            paymentConfirmed: false,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    for (const targetSlug of targetSlugs) {
      if (!targetSlug) continue;
      const pubRef = doc(db, 'publicProfiles', targetSlug);
      const pubSnap = await getDoc(pubRef);
      if (pubSnap.exists()) {
        batch.update(pubRef, {
          paymentConfirmed: isUnlocked,
          ...(isUnlocked ? { isPublic: true } : {}),
          lastPaidOrderId: isUnlocked ? params.order.orderId : '',
          updatedAt: serverTimestamp(),
        });
      } else if (linkedProfile) {
        batch.set(pubRef, {
          ...buildSanitizedPublicProfile({
            ...linkedProfile,
            slug: targetSlug,
            isPublic: isUnlocked ? true : linkedProfile.isPublic,
          }),
          paymentConfirmed: isUnlocked,
          ...(isUnlocked ? { lastPaidOrderId: params.order.orderId } : {}),
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
    await recordAuditLog({
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: 'ADMIN_PAYMENT_STATUS_UPDATE',
      targetCollection: 'orders',
      targetId: params.order.orderId,
      details: `Order ${params.order.orderNumber}: paymentStatus=${params.paymentStatus}, orderStatus=${nextOrderStatus}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `orders/${params.order.orderId}`);
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

export async function ensureOrderQrArtifact(params: {
  order: OrderRecord;
  profileSlug?: string;
  actor: { uid: string; email?: string; role: UserRole };
}): Promise<QrCodeRecord> {
  if (params.order.qrCodeId) {
    const existing = await getQrCodeById(params.order.qrCodeId);
    if (existing?.pngDataUrl) return existing;
  }
  const slug = sanitizeSlug(params.profileSlug || params.order.profileSlug || params.order.profileId);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://tapnex.in';
  const targetUrl = `${origin}/p/${slug}`;
  const qrArtifact = await generateHighResQrArtwork(targetUrl, 1024);

  const qrRecord: QrCodeRecord = {
    qrCodeId: params.order.orderId,
    uid: params.order.uid,
    orderId: params.order.orderId,
    printerId: params.order.printerId || '',
    targetUrl: qrArtifact.targetUrl,
    svgContent: qrArtifact.svgContent,
    pngDataUrl: qrArtifact.pngDataUrl,
    storagePath: `qrCodes/${params.order.orderId}/qr.png`,
    format: 'PNG_SVG',
    qrType: 'CUSTOMER_ORDER',
    version: 1,
    createdBy: params.actor.uid,
    createdAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'qrCodes', params.order.orderId), qrRecord);
  batch.update(doc(db, 'orders', params.order.orderId), {
    qrCodeId: params.order.orderId,
    printFileReady: true,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
    await recordAuditLog({
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: 'GENERATE_ORDER_QR',
      targetCollection: 'qrCodes',
      targetId: params.order.orderId,
      details: `Prepared high-res print QR for order ${params.order.orderNumber} (${qrArtifact.targetUrl})`,
    });
    return qrRecord;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `qrCodes/${params.order.orderId}`);
  }
}

export async function sendApprovedDesignToPrint(params: {
  design: CardDesignRecord;
  existingOrder?: OrderRecord | null;
  profile?: ProfileRecord | null;
  owner?: UserRecord | null;
  actor: { uid: string; email?: string; role: UserRole };
  quantity: number;
  cardType: string;
  subtotal: number;
  tax: number;
  shippingFee: number;
  total: number;
  printerId: string;
  initialOrderStatus: OrderStatus;
  markPaymentCompleted: boolean;
  shippingAddress: ShippingAddress;
  notes?: string;
}): Promise<{ orderId: string; orderNumber: string; qrRecord: QrCodeRecord }> {
  const existingOrder = params.existingOrder || null;
  const orderId = existingOrder?.orderId || `ord_${Date.now()}`;
  const year = new Date().getFullYear();
  const orderNumber =
    existingOrder?.orderNumber || `TNX-${year}-${String(Math.floor(100000 + Math.random() * 900000))}`;
  const slug = sanitizeSlug(
    params.profile?.slug || existingOrder?.profileSlug || params.design.profileId
  );

  let qrRecord: QrCodeRecord | null = null;
  if (existingOrder?.qrCodeId) {
    qrRecord = await getQrCodeById(existingOrder.qrCodeId);
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://tapnex.in';
  const targetUrl = `${origin}/p/${slug}`;
  if (!qrRecord?.pngDataUrl) {
    const qrArtifact = await generateHighResQrArtwork(targetUrl, 1024);
    qrRecord = {
      qrCodeId: orderId,
      uid: params.design.uid,
      orderId,
      printerId: params.printerId,
      targetUrl: qrArtifact.targetUrl,
      svgContent: qrArtifact.svgContent,
      pngDataUrl: qrArtifact.pngDataUrl,
      storagePath: `qrCodes/${orderId}/qr.png`,
      format: 'PNG_SVG',
      qrType: 'CUSTOMER_ORDER',
      version: 1,
      createdBy: params.actor.uid,
      createdAt: serverTimestamp(),
    };
  }

  const effectivePaymentStatus: PaymentStatus = params.markPaymentCompleted
    ? 'Verified'
    : existingOrder?.paymentStatus || 'Pending';

  const batch = writeBatch(db);
  const qrDocId = qrRecord.qrCodeId || orderId;
  if (existingOrder?.qrCodeId && existingOrder.qrCodeId === qrDocId && qrRecord.createdAt) {
    batch.update(doc(db, 'qrCodes', qrDocId), {
      printerId: params.printerId,
    });
  } else {
    batch.set(doc(db, 'qrCodes', qrDocId), {
      ...qrRecord,
      qrCodeId: qrDocId,
      orderId,
      printerId: params.printerId,
      createdAt: serverTimestamp(),
    });
  }

  if (existingOrder) {
    batch.update(doc(db, 'orders', orderId), {
      printerId: params.printerId,
      quantity: Math.max(1, Number(params.quantity) || 1),
      cardType: params.cardType,
      subtotal: params.subtotal,
      tax: params.tax,
      shipping: params.shippingFee,
      total: params.total,
      paymentStatus: effectivePaymentStatus,
      orderStatus: params.initialOrderStatus,
      shippingAddress: params.shippingAddress,
      qrCodeId: qrDocId,
      printFileReady: true,
      ...(params.notes !== undefined ? { internalNotes: params.notes } : {}),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(doc(db, 'orders', orderId), {
      orderId,
      orderNumber,
      uid: params.design.uid,
      profileId: params.design.profileId,
      profileSlug: slug,
      designId: params.design.designId,
      printerId: params.printerId,
      quantity: Math.max(1, Number(params.quantity) || 1),
      cardType: params.cardType,
      subtotal: params.subtotal,
      tax: params.tax,
      shipping: params.shippingFee,
      total: params.total,
      currency: 'INR',
      paymentStatus: effectivePaymentStatus,
      orderStatus: params.initialOrderStatus,
      shippingAddress: params.shippingAddress,
      qrCodeId: qrDocId,
      printFileReady: true,
      ...(params.notes ? { internalNotes: params.notes } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'cardDesigns', params.design.designId), {
    approved: true,
    locked: true,
    orderId,
    updatedAt: serverTimestamp(),
  });

  if (params.markPaymentCompleted) {
    const paymentRef = doc(db, 'payments', orderId);
    const paySnap = await getDoc(paymentRef);
    if (paySnap.exists()) {
      batch.update(paymentRef, {
        status: 'Verified',
        signatureVerified: true,
        verifiedAt: new Date().toISOString(),
      });
    } else {
      batch.set(paymentRef, {
        paymentId: orderId,
        orderId,
        uid: params.design.uid,
        gateway: 'razorpay_sandbox',
        gatewayOrderId: `admin_direct_${orderNumber}`,
        gatewayPaymentId: `admin_${Date.now()}`,
        signatureVerified: true,
        amount: params.total,
        currency: 'INR',
        status: 'Verified',
        verifiedAt: new Date().toISOString(),
        createdAt: serverTimestamp(),
      });
    }
  }

  if (params.markPaymentCompleted || params.initialOrderStatus === 'Delivered') {
    if (params.profile && !params.profile.adminDisabled) {
      batch.update(doc(db, 'profiles', params.profile.profileId), {
        paymentConfirmed: true,
        isPublic: true,
        updatedAt: serverTimestamp(),
      });
    }
    if (slug) {
      const pubRef = doc(db, 'publicProfiles', slug);
      const pubSnap = await getDoc(pubRef);
      if (pubSnap.exists()) {
        batch.update(pubRef, {
          paymentConfirmed: true,
          isPublic: true,
          lastPaidOrderId: orderId,
          updatedAt: serverTimestamp(),
        });
      } else if (params.profile) {
        batch.set(pubRef, {
          ...buildSanitizedPublicProfile({ ...params.profile, slug, isPublic: true }),
          paymentConfirmed: true,
          isPublic: true,
          lastPaidOrderId: orderId,
          updatedAt: serverTimestamp(),
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
      action: 'SEND_DESIGN_TO_PRINT',
      targetCollection: 'orders',
      targetId: orderId,
      details: `Sent design ${params.design.designId} (${orderNumber}) directly to print [${params.printerId}] status=${params.initialOrderStatus}, payment=${effectivePaymentStatus}`,
    });
    return { orderId, orderNumber, qrRecord };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
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

export async function saveAdminQrCode(params: {
  targetUrl: string;
  svgContent: string;
  pngDataUrl: string;
  customerName?: string;
  orderId?: string;
  description?: string;
  actor: { uid: string; email?: string; role: UserRole };
}): Promise<QrCodeRecord> {
  const qrCodeId = `qr_admin_${Date.now()}`;
  const record: QrCodeRecord = {
    qrCodeId,
    orderId: params.orderId || '',
    targetUrl: params.targetUrl,
    svgContent: params.svgContent,
    pngDataUrl: params.pngDataUrl,
    format: 'PNG_SVG',
    qrType: 'ADMIN_CUSTOM',
    customerName: params.customerName || '',
    description: params.description || '',
    version: 1,
    createdBy: params.actor.uid,
    createdAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'qrCodes', qrCodeId), record);
    await recordAuditLog({
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: 'GENERATE_ADMIN_QR',
      targetCollection: 'qrCodes',
      targetId: qrCodeId,
      details: `Generated QR for URL ${params.targetUrl}`,
    });
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `qrCodes/${qrCodeId}`);
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
    return snap.docs.map((d) => d.data() as PrinterRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'printers');
  }
}

export async function savePrinterRecord(
  printer: Omit<PrinterRecord, 'createdAt' | 'updatedAt'>,
  actor: { uid: string; email?: string; role: UserRole }
): Promise<void> {
  const ref = doc(db, 'printers', printer.printerId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        ...printer,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...printer,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
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
    const printerRef = doc(db, 'printers', params.targetUser.uid);
    batch.set(
      printerRef,
      {
        printerId: params.targetUser.uid,
        uid: params.targetUser.uid,
        businessName: params.targetUser.displayName || params.targetUser.username || 'Print Partner',
        contactPerson: params.targetUser.displayName || params.targetUser.email,
        email: params.targetUser.email,
        phone: params.targetUser.phone || '',
        status: params.newStatus === 'Active' ? 'Active' : 'Blocked',
        serviceAreas: ['All India'],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
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
  'payments',
  'qrCodes',
  'shippingRecords',
  'cardDesigns',
  'supportTickets',
  'notifications',
  'printers',
  'profiles',
  'publicProfiles',
  'auditLogs',
] as const;

export interface ApplicationResetOptions {
  includeAuditLogs?: boolean;
  restoreDefaultCatalog?: boolean;
}

export interface ApplicationResetResult {
  deletedCounts: Record<string, number>;
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

  const includeAuditLogs = options.includeAuditLogs ?? true;
  const restoreDefaultCatalog = options.restoreDefaultCatalog ?? true;

  const deletedCounts: Record<string, number> = {};
  const errors: Array<{ collection: string; message: string }> = [];

  const operationalTargets = RESETTABLE_OPERATIONAL_COLLECTIONS.filter(
    (col) => includeAuditLogs || col !== 'auditLogs'
  );

  for (const col of operationalTargets) {
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

  if (!includeAuditLogs) {
    await recordAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'APPLICATION_FACTORY_RESET',
      targetCollection: 'system',
      targetId: 'all',
      details: `Cleared ${totalDeleted} Firestore records and ${localDraftsCleared} local drafts`,
    });
  }

  return {
    deletedCounts,
    localDraftsCleared,
    totalDeleted,
    errors,
  };
}
