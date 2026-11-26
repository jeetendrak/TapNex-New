import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord as AuthUserRecord } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { Firestore, FieldValue, type DocumentReference, type Transaction } from '@google-cloud/firestore';
import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import { jsPDF } from 'jspdf';

const EXPECTED_FIREBASE_PROJECT_ID = 'gen-lang-client-0847571180';
const EXPECTED_FIRESTORE_DATABASE_ID = 'ai-studio-fd49cfa5-0ced-4799-9f48-6494d06b1b0d';
const EXPECTED_STORAGE_BUCKET = 'gen-lang-client-0847571180.firebasestorage.app';

const projectEnvEntries: Array<[string, string | undefined]> = [
  ['FIREBASE_PROJECT_ID', process.env.FIREBASE_PROJECT_ID],
  ['GOOGLE_CLOUD_PROJECT', process.env.GOOGLE_CLOUD_PROJECT],
  ['GCLOUD_PROJECT', process.env.GCLOUD_PROJECT],
];

for (const [envName, rawValue] of projectEnvEntries) {
  const trimmed = rawValue?.trim();
  if (trimmed && trimmed !== EXPECTED_FIREBASE_PROJECT_ID) {
    throw new Error(
      `Firebase project ID mismatch in ${envName}: received "${trimmed}", expected "${EXPECTED_FIREBASE_PROJECT_ID}".`
    );
  }
}

const firebaseProjectId = (
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  EXPECTED_FIREBASE_PROJECT_ID
).trim();

if (firebaseProjectId !== EXPECTED_FIREBASE_PROJECT_ID) {
  throw new Error(
    `Effective Firebase project ID mismatch: resolved "${firebaseProjectId || '(unset)'}", expected "${EXPECTED_FIREBASE_PROJECT_ID}".`
  );
}

const configuredDatabaseId = (
  process.env.FIRESTORE_DATABASE_ID || EXPECTED_FIRESTORE_DATABASE_ID
).trim();

if (!configuredDatabaseId || configuredDatabaseId === '(default)') {
  throw new Error(
    `Invalid FIRESTORE_DATABASE_ID "${configuredDatabaseId}". Refusing to initialize against the (default) Firestore database; expected "${EXPECTED_FIRESTORE_DATABASE_ID}".`
  );
}

if (configuredDatabaseId !== EXPECTED_FIRESTORE_DATABASE_ID) {
  throw new Error(
    `FIRESTORE_DATABASE_ID mismatch: received "${configuredDatabaseId}", expected "${EXPECTED_FIRESTORE_DATABASE_ID}".`
  );
}

const app = getApps().some((existing) => existing.name === '[DEFAULT]')
  ? getApp()
  : initializeApp({
      projectId: firebaseProjectId,
      storageBucket: (process.env.FIREBASE_STORAGE_BUCKET || EXPECTED_STORAGE_BUCKET).trim(),
    });

const appProjectId = app.options.projectId?.trim();
if (appProjectId !== EXPECTED_FIREBASE_PROJECT_ID) {
  throw new Error(
    `Firebase Admin app projectId mismatch: resolved "${appProjectId || '(unset)'}", expected "${EXPECTED_FIREBASE_PROJECT_ID}".`
  );
}

const auth = getAuth(app);
const storage = getStorage(app);

// Use production @google-cloud/firestore client with explicit named databaseId via ADC
const db = new Firestore({
  projectId: firebaseProjectId,
  databaseId: configuredDatabaseId,
});

if (db.databaseId !== EXPECTED_FIRESTORE_DATABASE_ID) {
  throw new Error(
    `Firestore client databaseId assertion failed: resolved "${db.databaseId}", expected "${EXPECTED_FIRESTORE_DATABASE_ID}".`
  );
}

type Role = 'USER' | 'PRINTER' | 'ADMIN' | 'SUPERADMIN';

interface CallableAuthContext {
  uid: string;
  token?: Record<string, unknown>;
}

async function assertRole(authInfo: CallableAuthContext, allowed: Role[]): Promise<Role> {
  const uid = authInfo.uid;
  const userSnap = await db.collection('users').doc(uid).get();
  const userData = userSnap.data();
  const userStatus = typeof userData?.status === 'string' ? userData.status : '';
  if (userStatus === 'Blocked' || userStatus === 'Disabled') {
    throw new HttpsError('permission-denied', 'Account is blocked or disabled.');
  }

  const requiresPrivilegedAccount = !allowed.includes('USER');
  if (requiresPrivilegedAccount && userStatus === 'Pending Verification') {
    throw new HttpsError('permission-denied', 'Account verification is pending.');
  }

  const adminSnap = await db.collection('admins').doc(uid).get();
  let resolvedRole: Role;
  if (adminSnap.exists) {
    const adminData = adminSnap.data() || {};
    if (adminData.active !== true) {
      throw new HttpsError('permission-denied', 'Admin account is inactive.');
    }
    const adminRole = adminData.role as Role;
    if (adminRole !== 'ADMIN' && adminRole !== 'SUPERADMIN') {
      throw new HttpsError('permission-denied', 'Admin record has an invalid role.');
    }
    if (!allowed.includes(adminRole)) {
      throw new HttpsError('permission-denied', `Requires one of roles: ${allowed.join(', ')}`);
    }
    resolvedRole = adminRole;
  } else {
    // Legacy users.role fallback applies only when admins/{uid} does not exist
    const userRole = (userData?.role || 'USER') as Role;
    if (!allowed.includes(userRole)) {
      throw new HttpsError('permission-denied', `Requires one of roles: ${allowed.join(', ')}`);
    }
    resolvedRole = userRole;
  }

  if (resolvedRole === 'ADMIN' || resolvedRole === 'SUPERADMIN') {
    if (authInfo.token?.email_verified !== true) {
      throw new HttpsError(
        'permission-denied',
        'Verified email session is required for administrator operations.'
      );
    }
  }

  if (resolvedRole === 'PRINTER') {
    const printerSnap = await db.collection('printers').doc(uid).get();
    const printerStatus = typeof printerSnap.data()?.status === 'string' ? printerSnap.data()?.status : '';
    if (
      printerSnap.exists &&
      (printerStatus === 'Blocked' ||
        printerStatus === 'Disabled' ||
        (requiresPrivilegedAccount && printerStatus === 'Pending Verification'))
    ) {
      throw new HttpsError('permission-denied', 'Printer account is blocked, disabled, or pending verification.');
    }
  }

  return resolvedRole;
}

function assertValidDocId(raw: unknown, label: string): string {
  const clean = typeof raw === 'string' ? raw.trim() : '';
  if (!clean || clean.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(clean)) {
    throw new HttpsError('invalid-argument', `Valid ${label} is required.`);
  }
  return clean;
}

function normalizePublicHttpUrl(raw: unknown): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed || trimmed.length > 2048) {
    throw new HttpsError('invalid-argument', 'Valid public http/https targetUrl is required.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpsError('invalid-argument', 'Invalid targetUrl format.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpsError('invalid-argument', 'targetUrl must use http:// or https:// protocol.');
  }
  if (!parsed.hostname) {
    throw new HttpsError('invalid-argument', 'targetUrl must include a valid hostname.');
  }
  return parsed.toString();
}

async function generateServerQrArtwork(params: {
  targetUrl: string;
  storagePath?: string;
}): Promise<{ svgContent: string; pngDataUrl: string }> {
  const svgContent = await QRCode.toString(params.targetUrl, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 4,
  });
  const pngBuffer = await QRCode.toBuffer(params.targetUrl, {
    errorCorrectionLevel: 'H',
    margin: 4,
    width: 1024,
  });
  const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  if (params.storagePath) {
    await storage.bucket().file(params.storagePath).save(pngBuffer, { contentType: 'image/png' });
  }
  return { svgContent, pngDataUrl };
}

async function writeAuditLog(params: {
  actorUid: string;
  actorEmail?: string;
  actorRole: Role | 'SYSTEM';
  action: string;
  targetCollection: string;
  targetId: string;
  details: string;
}) {
  const logRef = db.collection('auditLogs').doc();
  await logRef.set({
    logId: logRef.id,
    ...params,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// 1. createUserProfile
export const createUserProfile = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const email = req.auth.token.email || '';
  const emailVerified = Boolean(req.auth.token.email_verified);
  const now = FieldValue.serverTimestamp();
  const userRef = db.collection('users').doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) {
      tx.set(userRef, {
        uid,
        username: email.split('@')[0] || uid.slice(0, 8),
        email,
        displayName: req.data?.displayName || email.split('@')[0] || 'Customer',
        role: 'USER',
        status: emailVerified ? 'Active' : 'Pending Verification',
        emailVerified,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });
    }
  });
  return { uid, role: 'USER' };
});

// 2. bootstrapSuperAdmin (One-time env-driven setup)
export const bootstrapSuperAdmin = onCall(async (req) => {
  if (process.env.SUPERADMIN_BOOTSTRAP_ENABLED !== 'true') {
    throw new HttpsError('failed-precondition', 'SuperAdmin bootstrap is disabled.');
  }
  const { username, password } = req.data as { username: string; password: string };
  if (
    username !== process.env.SUPERADMIN_INITIAL_USERNAME ||
    password !== process.env.SUPERADMIN_INITIAL_PASSWORD
  ) {
    throw new HttpsError('permission-denied', 'Invalid bootstrap credentials.');
  }
  const email = process.env.SUPERADMIN_INITIAL_EMAIL || 'superadmin@tapnex.in';
  let userRecord: AuthUserRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch {
    userRecord = await auth.createUser({ email, password, emailVerified: true, displayName: 'SuperAdmin' });
  }
  await auth.setCustomUserClaims(userRecord.uid, { role: 'SUPERADMIN' });
  const now = FieldValue.serverTimestamp();
  await db.collection('users').doc(userRecord.uid).set(
    {
      uid: userRecord.uid,
      username: 'superadmin',
      email,
      displayName: 'Platform SuperAdmin',
      role: 'SUPERADMIN',
      status: 'Active',
      emailVerified: true,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );
  await db.collection('admins').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email,
    role: 'SUPERADMIN',
    active: true,
    permissions: ['ALL'],
    updatedAt: now,
  });
  await writeAuditLog({
    actorUid: userRecord.uid,
    actorEmail: email,
    actorRole: 'SYSTEM',
    action: 'BOOTSTRAP_SUPERADMIN',
    targetCollection: 'users',
    targetId: userRecord.uid,
    details: 'One-time SuperAdmin provisioned with mandatory password rotation flag.',
  });
  return { uid: userRecord.uid, mustChangePassword: true };
});

// 3. assignUserRole
export const assignUserRole = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['ADMIN', 'SUPERADMIN']);
  const { targetUid, newRole } = req.data as { targetUid: string; newRole: Role };
  if (!['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN'].includes(newRole)) {
    throw new HttpsError('invalid-argument', 'Invalid role.');
  }
  if ((newRole === 'SUPERADMIN' || targetUid === req.auth.uid) && actorRole !== 'SUPERADMIN') {
    throw new HttpsError('permission-denied', 'Only SuperAdmin can assign SuperAdmin role.');
  }
  const superAdminsSnap = await db.collection('admins').where('role', '==', 'SUPERADMIN').where('active', '==', true).get();
  if (superAdminsSnap.size <= 1 && superAdminsSnap.docs[0]?.id === targetUid && newRole !== 'SUPERADMIN') {
    throw new HttpsError('failed-precondition', 'Cannot demote the last active SuperAdmin.');
  }

  await auth.setCustomUserClaims(targetUid, { role: newRole });
  await db.collection('users').doc(targetUid).update({ role: newRole, updatedAt: FieldValue.serverTimestamp() });
  if (newRole === 'ADMIN' || newRole === 'SUPERADMIN') {
    const u = await db.collection('users').doc(targetUid).get();
    await db.collection('admins').doc(targetUid).set({
      uid: targetUid,
      email: u.data()?.email || '',
      role: newRole,
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await db.collection('admins').doc(targetUid).delete();
  }
  await writeAuditLog({
    actorUid: req.auth.uid,
    actorRole,
    action: 'ASSIGN_ROLE',
    targetCollection: 'users',
    targetId: targetUid,
    details: `Role changed to ${newRole}`,
  });
  return { targetUid, newRole };
});

// 4. updateUserStatus
export const updateUserStatus = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['ADMIN', 'SUPERADMIN']);
  const { targetUid, status } = req.data as { targetUid: string; status: string };
  await auth.updateUser(targetUid, { disabled: status === 'Blocked' || status === 'Disabled' });
  await db.collection('users').doc(targetUid).update({ status, updatedAt: FieldValue.serverTimestamp() });
  await writeAuditLog({
    actorUid: req.auth.uid,
    actorRole,
    action: 'UPDATE_USER_STATUS',
    targetCollection: 'users',
    targetId: targetUid,
    details: `Status set to ${status}`,
  });
  return { targetUid, status };
});

// 5. generatePublicProfileSlug
export const generatePublicProfileSlug = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const base = String(req.data?.desiredSlug || 'profile')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  let candidate = base.length >= 3 ? base : `card-${req.auth.uid.slice(0, 6).toLowerCase()}`;
  const existing = await db.collection('publicProfiles').doc(candidate).get();
  if (existing.exists && existing.data()?.uid !== req.auth.uid) {
    candidate = `${candidate}-${Math.floor(100 + Math.random() * 900)}`;
  }
  return { slug: candidate, available: true };
});

const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');
const razorpayWebhookSecret = defineSecret('RAZORPAY_WEBHOOK_SECRET');

const RAZORPAY_API_BASE_URL = 'https://api.razorpay.com/v1';

const CARD_TIER_PRICING: Record<'minimal' | 'designer', Record<'qr_only' | 'qr_smart', number>> = {
  minimal: { qr_only: 499, qr_smart: 999 },
  designer: { qr_only: 599, qr_smart: 1499 },
};

const MINIMAL_TEMPLATE_IDS = new Set([
  'azure-tech-waves',
  'minimal-white',
  'blue-gradient',
  'modern-business',
  'slate-wave-minimal',
  'blank-custom',
]);

const FIXED_PACK_TEMPLATE_IDS = new Set([
  'pet-dog-tag-classic',
  'belongings-helmet-sticker-round',
]);

const TERMINAL_PAYMENT_STATUSES = new Set(['Verified', 'Completed', 'Refunded']);
const ELIGIBLE_CHECKOUT_PAYMENT_STATUSES = new Set(['', 'Pending', 'Failed', 'Created']);
const ELIGIBLE_CHECKOUT_ORDER_STATUSES = new Set(['', 'Awaiting Payment', 'Design Approved', 'Design Pending']);
const PROGRESSED_ORDER_STATUSES = new Set([
  'Payment Successful',
  'Processing',
  'Assigned to Printer',
  'Printing in Progress',
  'Quality Check',
  'Ready for Dispatch',
  'Dispatched',
  'In Transit',
  'Delivered',
]);

function constantTimeHexEquals(provided: string, expectedHex: string): boolean {
  const cleanProvided = provided.trim();
  const cleanExpected = expectedHex.trim();
  if (!/^[0-9a-f]{64}$/i.test(cleanProvided) || !/^[0-9a-f]{64}$/i.test(cleanExpected)) {
    return false;
  }
  const providedBuf = Buffer.from(cleanProvided, 'hex');
  const expectedBuf = Buffer.from(cleanExpected, 'hex');
  if (providedBuf.length !== 32 || expectedBuf.length !== 32 || providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function isValidLiveRazorpayOrderId(value: string): boolean {
  return (
    /^order_[A-Za-z0-9_]{6,64}$/.test(value) &&
    !/(_sbx_|sandbox|manual|admin_direct|fake)/i.test(value)
  );
}

function isValidLiveRazorpayPaymentId(value: string): boolean {
  return (
    /^pay_[A-Za-z0-9_]{6,64}$/.test(value) &&
    !/(_sbx_|sandbox|manual|upi_|gpay_|admin_|fake)/i.test(value)
  );
}

function sanitizeSlug(raw: unknown): string {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function requireRazorpayApiCredentials(): { keyId: string; keySecret: string } {
  const keyId = razorpayKeyId.value().trim();
  const keySecret = razorpayKeySecret.value().trim();
  if (!keyId || !keySecret) {
    throw new HttpsError(
      'failed-precondition',
      'Razorpay API credentials (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) are not configured.'
    );
  }
  return { keyId, keySecret };
}

function razorpayBasicAuthHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
}

interface AuthoritativeOrderPricing {
  orderSource: 'studio' | 'shop';
  quantity: number;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  amountPaise: number;
  currency: 'INR';
}

async function computeAuthoritativeOrderPricing(
  orderId: string,
  orderData: Record<string, unknown>,
  uid: string
): Promise<AuthoritativeOrderPricing> {
  if (orderData.currency !== 'INR') {
    throw new HttpsError(
      'failed-precondition',
      `Unsupported order currency "${String(orderData.currency || '(unset)')}". Only INR is supported.`
    );
  }

  const paymentStatus = String(orderData.paymentStatus || '').trim();
  const orderStatus = String(orderData.orderStatus || '').trim();

  if (TERMINAL_PAYMENT_STATUSES.has(paymentStatus)) {
    throw new HttpsError(
      'failed-precondition',
      `Order ${orderId} cannot create a payment order because paymentStatus is already "${paymentStatus}".`
    );
  }
  if (!ELIGIBLE_CHECKOUT_PAYMENT_STATUSES.has(paymentStatus)) {
    throw new HttpsError(
      'failed-precondition',
      `Order ${orderId} has ineligible paymentStatus "${paymentStatus}".`
    );
  }
  if (!ELIGIBLE_CHECKOUT_ORDER_STATUSES.has(orderStatus)) {
    throw new HttpsError(
      'failed-precondition',
      `Order ${orderId} has ineligible orderStatus "${orderStatus}".`
    );
  }

  const settingsSnap = await db.collection('appSettings').doc('global').get();
  if (!settingsSnap.exists) {
    throw new HttpsError(
      'failed-precondition',
      'Missing authoritative pricing configuration: appSettings/global does not exist.'
    );
  }
  const settingsData = (settingsSnap.data() || {}) as Record<string, unknown>;
  const gateways = settingsData.paymentGateways as Record<string, { enabled?: unknown }> | undefined;
  if (gateways?.razorpay?.enabled === false) {
    throw new HttpsError(
      'failed-precondition',
      'Razorpay payment gateway is disabled in appSettings/global.'
    );
  }

  const taxRatePercent = settingsData.taxRatePercent;
  if (
    typeof taxRatePercent !== 'number' ||
    !Number.isFinite(taxRatePercent) ||
    taxRatePercent < 0 ||
    taxRatePercent > 100
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Missing or invalid authoritative taxRatePercent in appSettings/global.'
    );
  }

  const shippingFeeInr = settingsData.shippingFeeInr;
  if (
    typeof shippingFeeInr !== 'number' ||
    !Number.isFinite(shippingFeeInr) ||
    shippingFeeInr < 0 ||
    shippingFeeInr > 100000
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Missing or invalid authoritative shippingFeeInr in appSettings/global.'
    );
  }

  const isShopOrder = orderData.orderSource === 'shop' || orderData.designId === 'shop_direct';
  let subtotalInr = 0;
  let authoritativeQty = 0;

  if (isShopOrder) {
    const rawItems = orderData.shopItems;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        `Shop order ${orderId} is missing shopItems required for authoritative pricing.`
      );
    }

    for (const rawItem of rawItems) {
      const item = (rawItem || {}) as Record<string, unknown>;
      const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
      const itemQty = Number(item.quantity);
      if (!productId) {
        throw new HttpsError(
          'failed-precondition',
          `Shop order ${orderId} contains a line item without a valid productId.`
        );
      }
      if (!Number.isInteger(itemQty) || itemQty < 1 || itemQty > 50) {
        throw new HttpsError(
          'invalid-argument',
          `Invalid quantity (${String(item.quantity)}) for shopProducts/${productId}.`
        );
      }

      const prodSnap = await db.collection('shopProducts').doc(productId).get();
      if (!prodSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          `Missing authoritative shop product record: shopProducts/${productId}.`
        );
      }
      const prod = (prodSnap.data() || {}) as Record<string, unknown>;
      if (prod.visibleOnShop === false) {
        throw new HttpsError(
          'failed-precondition',
          `Shop product is not available for purchase: shopProducts/${productId}.`
        );
      }
      if (prod.inStock === false) {
        throw new HttpsError(
          'failed-precondition',
          `Shop product is out of stock: shopProducts/${productId}.`
        );
      }
      const priceInr = prod.priceInr;
      if (typeof priceInr !== 'number' || !Number.isFinite(priceInr) || priceInr <= 0) {
        throw new HttpsError(
          'failed-precondition',
          `Missing or invalid authoritative priceInr on shopProducts/${productId}.`
        );
      }

      subtotalInr += priceInr * itemQty;
      authoritativeQty += itemQty;
    }

    const orderQty = Number(orderData.quantity);
    if (!Number.isInteger(orderQty) || orderQty !== authoritativeQty || authoritativeQty < 1 || authoritativeQty > 100) {
      throw new HttpsError(
        'invalid-argument',
        `Order quantity (${String(orderData.quantity)}) does not match validated shop item quantity (${authoritativeQty}).`
      );
    }
  } else {
    const quantity = Number(orderData.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new HttpsError(
        'invalid-argument',
        `Order quantity (${String(orderData.quantity)}) must be an integer between 1 and 100.`
      );
    }

    const designId = typeof orderData.designId === 'string' ? orderData.designId.trim() : '';
    if (!designId) {
      throw new HttpsError(
        'failed-precondition',
        `Studio order ${orderId} is missing designId required for authoritative pricing.`
      );
    }

    const designSnap = await db.collection('cardDesigns').doc(designId).get();
    if (!designSnap.exists) {
      throw new HttpsError(
        'failed-precondition',
        `Missing authoritative card design record: cardDesigns/${designId}.`
      );
    }
    const design = (designSnap.data() || {}) as Record<string, unknown>;
    if (design.uid !== uid) {
      throw new HttpsError(
        'permission-denied',
        `Card design cardDesigns/${designId} does not belong to the authenticated customer.`
      );
    }
    if (design.locked !== true) {
      throw new HttpsError(
        'failed-precondition',
        `Card design cardDesigns/${designId} must be locked before payment order creation.`
      );
    }
    const designOrderId = typeof design.orderId === 'string' ? design.orderId.trim() : '';
    if (!designOrderId || designOrderId !== orderId) {
      throw new HttpsError(
        'failed-precondition',
        `Card design cardDesigns/${designId} is not linked to order ${orderId}.`
      );
    }

    const templateId = typeof design.templateId === 'string' ? design.templateId.trim() : '';
    if (!templateId) {
      throw new HttpsError(
        'failed-precondition',
        `Missing templateId on cardDesigns/${designId}.`
      );
    }

    let cardTechnology: 'qr_only' | 'qr_smart' | null = null;
    if (design.cardTechnology === 'qr_only' || design.cardTechnology === 'qr_smart') {
      cardTechnology = design.cardTechnology;
    } else {
      const frontDesign = design.frontDesign as { showNfcIcon?: unknown } | undefined;
      if (typeof frontDesign?.showNfcIcon === 'boolean') {
        cardTechnology = frontDesign.showNfcIcon ? 'qr_smart' : 'qr_only';
      }
    }
    if (!cardTechnology) {
      throw new HttpsError(
        'failed-precondition',
        `Missing authoritative cardTechnology on cardDesigns/${designId}.`
      );
    }

    const tplSnap = await db.collection('cardTemplates').doc(templateId).get();
    if (!tplSnap.exists) {
      throw new HttpsError(
        'failed-precondition',
        `Missing authoritative card template record: cardTemplates/${templateId}.`
      );
    }
    const tpl = (tplSnap.data() || {}) as Record<string, unknown>;
    if (tpl.active === false) {
      throw new HttpsError(
        'failed-precondition',
        `Card template is inactive: cardTemplates/${templateId}.`
      );
    }

    const isFixedPack = tpl.pricingMode === 'fixed_pack' || FIXED_PACK_TEMPLATE_IDS.has(templateId);
    let unitPriceInr = 0;

    if (isFixedPack) {
      const tplPrice = tpl.priceInr;
      if (typeof tplPrice !== 'number' || !Number.isFinite(tplPrice) || tplPrice <= 0) {
        throw new HttpsError(
          'failed-precondition',
          `Missing or invalid fixed_pack priceInr on cardTemplates/${templateId}.`
        );
      }
      unitPriceInr = tplPrice;
    } else {
      let designTier: 'minimal' | 'designer' | null = null;
      if (tpl.designTier === 'minimal' || tpl.designTier === 'designer') {
        designTier = tpl.designTier;
      } else if (MINIMAL_TEMPLATE_IDS.has(templateId)) {
        designTier = 'minimal';
      } else if (typeof tpl.category === 'string' && tpl.category.trim().length > 0) {
        const lowerCat = tpl.category.toLowerCase();
        designTier = lowerCat.includes('minimal') || lowerCat.includes('custom upload') ? 'minimal' : 'designer';
      }

      if (!designTier) {
        throw new HttpsError(
          'failed-precondition',
          `Missing designTier or category on cardTemplates/${templateId}.`
        );
      }
      unitPriceInr = CARD_TIER_PRICING[designTier][cardTechnology];
    }

    subtotalInr = unitPriceInr * quantity;
    authoritativeQty = quantity;
  }

  const subtotal = Math.round(subtotalInr * 100) / 100;
  const tax = Math.round((subtotal * taxRatePercent) / 100);
  const shipping = subtotal > 0 ? Math.round(shippingFeeInr * 100) / 100 : 0;
  const total = Math.round((subtotal + tax + shipping) * 100) / 100;
  const amountPaise = Math.round(total * 100);

  if (!Number.isInteger(amountPaise) || amountPaise < 100) {
    throw new HttpsError(
      'failed-precondition',
      `Computed payable amount (${amountPaise} paise) is below the ₹1.00 Razorpay minimum.`
    );
  }

  return {
    orderSource: isShopOrder ? 'shop' : 'studio',
    quantity: authoritativeQty,
    subtotal,
    tax,
    shipping,
    total,
    amountPaise,
    currency: 'INR',
  };
}

interface RazorpayOrderApiResponse {
  id?: string;
  amount?: number;
  amount_paid?: number;
  currency?: string;
  status?: string;
  receipt?: string;
}

interface RazorpayPaymentApiResponse {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  method?: string;
  captured?: boolean;
}

const RAZORPAY_CREATION_LOCK_TTL_MS = 60_000;

async function fetchRazorpayOrderById(
  gatewayOrderId: string,
  keyId: string,
  keySecret: string
): Promise<RazorpayOrderApiResponse> {
  const resp = await fetch(`${RAZORPAY_API_BASE_URL}/orders/${encodeURIComponent(gatewayOrderId)}`, {
    method: 'GET',
    headers: {
      Authorization: razorpayBasicAuthHeader(keyId, keySecret),
    },
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new HttpsError(
      'failed-precondition',
      `Failed to inspect existing Razorpay order ${gatewayOrderId} (HTTP ${resp.status}): ${errBody.slice(0, 200)}`
    );
  }
  return (await resp.json()) as RazorpayOrderApiResponse;
}

async function fetchRazorpayPaymentById(
  paymentId: string,
  keyId: string,
  keySecret: string
): Promise<RazorpayPaymentApiResponse> {
  const resp = await fetch(`${RAZORPAY_API_BASE_URL}/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: {
      Authorization: razorpayBasicAuthHeader(keyId, keySecret),
    },
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new HttpsError(
      'failed-precondition',
      `Failed to verify payment with Razorpay API (HTTP ${resp.status}): ${errBody.slice(0, 200)}`
    );
  }
  return (await resp.json()) as RazorpayPaymentApiResponse;
}

async function applyVerifiedPaymentInTransaction(params: {
  tx: Transaction;
  orderId: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  expectedAmountPaise: number;
  verifiedVia: 'verifyPayment' | 'razorpayWebhook';
  webhookEventId?: string;
}): Promise<{ outcome: 'verified' | 'already_verified' | 'conflict' | 'terminal_ignored'; reason?: string }> {
  const { tx, orderId, gatewayOrderId, gatewayPaymentId, expectedAmountPaise, verifiedVia, webhookEventId } = params;
  const orderRef = db.collection('orders').doc(orderId);
  const paymentRef = db.collection('payments').doc(orderId);
  const usedPaymentRef = db.collection('razorpayPayments').doc(gatewayPaymentId);

  const [orderSnap, paymentSnap, usedPaymentSnap] = await Promise.all([
    tx.get(orderRef),
    tx.get(paymentRef),
    tx.get(usedPaymentRef),
  ]);

  if (!orderSnap.exists) {
    throw new HttpsError('not-found', `Order ${orderId} not found.`);
  }
  const orderData = (orderSnap.data() || {}) as Record<string, unknown>;

  if (usedPaymentSnap.exists && usedPaymentSnap.data()?.orderId !== orderId) {
    return {
      outcome: 'conflict',
      reason: `Razorpay payment ${gatewayPaymentId} is already bound to order ${String(usedPaymentSnap.data()?.orderId)}.`,
    };
  }

  const currentOrderStatus = String(orderData.orderStatus || '').trim();
  const currentPaymentStatus = String(orderData.paymentStatus || '').trim();

  if (currentOrderStatus === 'Cancelled' || currentOrderStatus === 'Refunded' || currentPaymentStatus === 'Refunded') {
    return {
      outcome: 'terminal_ignored',
      reason: `Order ${orderId} has terminal status (${currentOrderStatus || currentPaymentStatus}).`,
    };
  }

  const existingOrderPaymentId = String(orderData.razorpayPaymentId || '').trim();
  const existingPaymentDocId = paymentSnap.exists ? String(paymentSnap.data()?.gatewayPaymentId || '').trim() : '';
  const paymentDocStatus = paymentSnap.exists ? String(paymentSnap.data()?.status || '').trim() : '';

  if (currentPaymentStatus === 'Verified' || currentPaymentStatus === 'Completed') {
    const existingBoundId = existingOrderPaymentId || existingPaymentDocId;
    if (existingBoundId && existingBoundId !== gatewayPaymentId) {
      return {
        outcome: 'conflict',
        reason: `Order ${orderId} is already paid with a different Razorpay payment ID (${existingBoundId}).`,
      };
    }
    return { outcome: 'already_verified' };
  }

  if (
    paymentSnap.exists &&
    (paymentDocStatus === 'Verified' || paymentDocStatus === 'Completed') &&
    existingPaymentDocId &&
    existingPaymentDocId !== gatewayPaymentId
  ) {
    return {
      outcome: 'conflict',
      reason: `Payment record payments/${orderId} is already verified with payment ID (${existingPaymentDocId}).`,
    };
  }

  const profileId = typeof orderData.profileId === 'string' ? orderData.profileId.trim() : '';
  const profileRef = profileId && profileId !== 'shop_cart' ? db.collection('profiles').doc(profileId) : null;
  const profileSnap = profileRef ? await tx.get(profileRef) : null;

  const resolvedSlug = sanitizeSlug(
    orderData.profileSlug || (profileSnap?.exists ? profileSnap.data()?.slug : '')
  );
  const publicProfileRef = resolvedSlug ? db.collection('publicProfiles').doc(resolvedSlug) : null;
  const publicProfileSnap = publicProfileRef ? await tx.get(publicProfileRef) : null;

  const now = FieldValue.serverTimestamp();
  const amountInr = Math.round(expectedAmountPaise) / 100;
  const nextOrderStatus = PROGRESSED_ORDER_STATUSES.has(currentOrderStatus)
    ? currentOrderStatus
    : 'Payment Successful';

  tx.set(
    usedPaymentRef,
    {
      gatewayPaymentId,
      gatewayOrderId,
      orderId,
      uid: orderData.uid || '',
      amountPaise: expectedAmountPaise,
      currency: 'INR',
      verifiedVia,
      ...(webhookEventId ? { webhookEventId } : {}),
      verifiedAt: now,
    },
    { merge: true }
  );

  tx.set(
    paymentRef,
    {
      paymentId: orderId,
      orderId,
      uid: orderData.uid || '',
      gateway: 'razorpay_live',
      gatewayOrderId,
      gatewayPaymentId,
      signatureVerified: true,
      amount: amountInr,
      amountPaise: expectedAmountPaise,
      currency: 'INR',
      status: 'Verified',
      verifiedVia,
      ...(webhookEventId ? { lastWebhookEventId: webhookEventId } : {}),
      verifiedAt: now,
      updatedAt: now,
      ...(paymentSnap.exists ? {} : { createdAt: now }),
    },
    { merge: true }
  );

  tx.update(orderRef, {
    paymentStatus: 'Verified',
    orderStatus: nextOrderStatus,
    razorpayOrderId: gatewayOrderId,
    razorpayPaymentId: gatewayPaymentId,
    razorpayAmountPaise: expectedAmountPaise,
    razorpayCurrency: 'INR',
    updatedAt: now,
  });

  if (profileRef && profileSnap?.exists && !profileSnap.data()?.adminDisabled) {
    tx.update(profileRef, {
      paymentConfirmed: true,
      isPublic: true,
      updatedAt: now,
    });
  }

  if (publicProfileRef && publicProfileSnap?.exists && !publicProfileSnap.data()?.adminDisabled) {
    tx.update(publicProfileRef, {
      paymentConfirmed: true,
      isPublic: true,
      lastPaidOrderId: orderId,
      updatedAt: now,
    });
  }

  return { outcome: 'verified' };
}

async function releaseOrderCreationLockSafely(
  orderRef: DocumentReference,
  attemptId: string
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const data = (snap.data() || {}) as Record<string, unknown>;
    const existingOrderId = typeof data.razorpayOrderId === 'string' ? data.razorpayOrderId.trim() : '';
    const lock = data.razorpayOrderLock as Record<string, unknown> | null | undefined;
    if (existingOrderId || !lock || lock.attemptId !== attemptId || lock.status !== 'creating') {
      return;
    }
    tx.update(orderRef, {
      razorpayOrderLock: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function markOrderCreationAmbiguousSafely(
  orderRef: DocumentReference,
  attemptId: string,
  reason: string
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const data = (snap.data() || {}) as Record<string, unknown>;
    const lock = data.razorpayOrderLock as Record<string, unknown> | null | undefined;
    if (!lock || lock.attemptId !== attemptId) {
      return;
    }
    tx.update(orderRef, {
      razorpayOrderLock: {
        ...lock,
        status: 'ambiguous',
        reason: reason.slice(0, 250),
        markedAmbiguousAtMs: Date.now(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

// 6. createPaymentOrder
export const createPaymentOrder = onCall(
  { secrets: [razorpayKeyId, razorpayKeySecret] },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
    const uid = req.auth.uid;
    const orderId = typeof req.data?.orderId === 'string' ? req.data.orderId.trim() : '';
    if (!orderId || orderId.includes('/')) {
      throw new HttpsError('invalid-argument', 'Valid orderId is required.');
    }

    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new HttpsError('not-found', 'Order not found.');
    }

    const orderData = (orderSnap.data() || {}) as Record<string, unknown>;
    if (orderData.uid !== uid) {
      throw new HttpsError('permission-denied', 'You do not own this order.');
    }

    const pricing = await computeAuthoritativeOrderPricing(orderId, orderData, uid);
    const { keyId, keySecret } = requireRazorpayApiCredentials();
    const paymentRef = db.collection('payments').doc(orderId);

    const attemptId = crypto.randomUUID();
    const lockNowMs = Date.now();

    const preflight = await db.runTransaction(async (tx) => {
      const latestSnap = await tx.get(orderRef);
      if (!latestSnap.exists) {
        throw new HttpsError('not-found', 'Order not found.');
      }
      const latestData = (latestSnap.data() || {}) as Record<string, unknown>;
      if (latestData.uid !== uid) {
        throw new HttpsError('permission-denied', 'You do not own this order.');
      }
      if (latestData.currency !== 'INR') {
        throw new HttpsError('failed-precondition', 'Order currency must be INR.');
      }

      const latestPayStatus = String(latestData.paymentStatus || '').trim();
      const latestOrderStatus = String(latestData.orderStatus || '').trim();
      if (TERMINAL_PAYMENT_STATUSES.has(latestPayStatus)) {
        throw new HttpsError(
          'failed-precondition',
          `Order ${orderId} already reached paymentStatus "${latestPayStatus}".`
        );
      }
      if (!ELIGIBLE_CHECKOUT_PAYMENT_STATUSES.has(latestPayStatus)) {
        throw new HttpsError(
          'failed-precondition',
          `Order ${orderId} has ineligible paymentStatus "${latestPayStatus}".`
        );
      }
      if (!ELIGIBLE_CHECKOUT_ORDER_STATUSES.has(latestOrderStatus)) {
        throw new HttpsError(
          'failed-precondition',
          `Order ${orderId} has ineligible orderStatus "${latestOrderStatus}".`
        );
      }

      const existingGatewayOrderId =
        typeof latestData.razorpayOrderId === 'string' ? latestData.razorpayOrderId.trim() : '';
      if (existingGatewayOrderId) {
        return {
          mode: 'inspect_existing' as const,
          existingGatewayOrderId,
          orderNumber: latestData.orderNumber,
        };
      }

      const existingLock = latestData.razorpayOrderLock as Record<string, unknown> | null | undefined;
      if (existingLock && typeof existingLock === 'object') {
        const lockStatus = String(existingLock.status || '').trim();
        const expiresAtMs = Number(existingLock.expiresAtMs || 0);
        if (lockStatus === 'ambiguous') {
          const detail =
            typeof existingLock.reason === 'string' && existingLock.reason.trim()
              ? ` (${existingLock.reason.trim()})`
              : '';
          return {
            mode: 'ambiguous_blocked' as const,
            reason: `Previous Razorpay order creation attempt is in an ambiguous state${detail} and requires reconciliation.`,
          };
        }
        if (lockStatus === 'creating') {
          if (Number.isFinite(expiresAtMs) && lockNowMs < expiresAtMs) {
            throw new HttpsError(
              'aborted',
              `Razorpay order creation is already in progress for order ${orderId}.`
            );
          }
          tx.update(orderRef, {
            razorpayOrderLock: {
              ...existingLock,
              status: 'ambiguous',
              reason: 'Previous Razorpay order creation lock expired without completion.',
              markedAmbiguousAtMs: lockNowMs,
            },
            updatedAt: FieldValue.serverTimestamp(),
          });
          return {
            mode: 'ambiguous_blocked' as const,
            reason:
              'Previous Razorpay order creation attempt expired in an ambiguous state and requires reconciliation.',
          };
        }
        throw new HttpsError(
          'failed-precondition',
          `Order ${orderId} has an unrecognized Razorpay creation lock state.`
        );
      }

      tx.update(orderRef, {
        razorpayOrderLock: {
          attemptId,
          uid,
          status: 'creating',
          acquiredAtMs: lockNowMs,
          expiresAtMs: lockNowMs + RAZORPAY_CREATION_LOCK_TTL_MS,
          amountPaise: pricing.amountPaise,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        mode: 'create_new' as const,
        orderNumber: latestData.orderNumber,
      };
    });

    if (preflight.mode === 'ambiguous_blocked') {
      throw new HttpsError('failed-precondition', preflight.reason);
    }

    if (preflight.mode === 'inspect_existing') {
      const existingGatewayOrderId = preflight.existingGatewayOrderId;
      if (!isValidLiveRazorpayOrderId(existingGatewayOrderId)) {
        throw new HttpsError(
          'failed-precondition',
          `Order ${orderId} has an invalid existing razorpayOrderId and cannot be reused.`
        );
      }

      const existingRzpOrder = await fetchRazorpayOrderById(existingGatewayOrderId, keyId, keySecret);
      const rzpStatus = String(existingRzpOrder.status || '').trim();
      const amountPaid =
        typeof existingRzpOrder.amount_paid === 'number' ? existingRzpOrder.amount_paid : 0;

      if (rzpStatus === 'paid' || amountPaid > 0) {
        throw new HttpsError(
          'already-exists',
          `Existing Razorpay order ${existingGatewayOrderId} is already paid (status "${rzpStatus}") and requires payment reconciliation.`
        );
      }

      if (
        existingRzpOrder.id !== existingGatewayOrderId ||
        rzpStatus !== 'created' ||
        Number(existingRzpOrder.amount) !== pricing.amountPaise ||
        existingRzpOrder.currency !== 'INR'
      ) {
        throw new HttpsError(
          'failed-precondition',
          `Existing Razorpay order ${existingGatewayOrderId} cannot be reused (status="${rzpStatus}", amount=${String(existingRzpOrder.amount)}, currency="${String(existingRzpOrder.currency)}") and will not be overwritten.`
        );
      }

      await db.runTransaction(async (tx) => {
        const [latestOrderSnap, latestPaySnap] = await Promise.all([
          tx.get(orderRef),
          tx.get(paymentRef),
        ]);
        if (!latestOrderSnap.exists) {
          throw new HttpsError('not-found', 'Order disappeared during Razorpay reuse verification.');
        }
        const latestOrder = (latestOrderSnap.data() || {}) as Record<string, unknown>;
        const latestPayStatus = String(latestOrder.paymentStatus || '').trim();
        if (TERMINAL_PAYMENT_STATUSES.has(latestPayStatus)) {
          throw new HttpsError(
            'failed-precondition',
            `Order ${orderId} already reached paymentStatus "${latestPayStatus}".`
          );
        }
        const storedOrderId =
          typeof latestOrder.razorpayOrderId === 'string' ? latestOrder.razorpayOrderId.trim() : '';
        if (storedOrderId !== existingGatewayOrderId) {
          throw new HttpsError(
            'aborted',
            `Order ${orderId} razorpayOrderId changed concurrently during verification.`
          );
        }
        if (
          typeof latestOrder.razorpayAmountPaise === 'number' &&
          latestOrder.razorpayAmountPaise !== pricing.amountPaise
        ) {
          throw new HttpsError(
            'failed-precondition',
            `Order ${orderId} stored razorpayAmountPaise (${latestOrder.razorpayAmountPaise}) mismatches authoritative pricing (${pricing.amountPaise}).`
          );
        }

        const now = FieldValue.serverTimestamp();
        tx.update(orderRef, {
          razorpayAmountPaise: pricing.amountPaise,
          razorpayCurrency: 'INR',
          subtotal: pricing.subtotal,
          tax: pricing.tax,
          shipping: pricing.shipping,
          total: pricing.total,
          updatedAt: now,
        });

        const existingPayStatus = latestPaySnap.exists
          ? String(latestPaySnap.data()?.status || '').trim()
          : '';
        if (!TERMINAL_PAYMENT_STATUSES.has(existingPayStatus)) {
          tx.set(
            paymentRef,
            {
              paymentId: orderId,
              orderId,
              uid,
              gateway: 'razorpay_live',
              gatewayOrderId: existingGatewayOrderId,
              signatureVerified: false,
              amount: pricing.total,
              amountPaise: pricing.amountPaise,
              currency: 'INR',
              status: existingPayStatus || 'Created',
              updatedAt: now,
              ...(latestPaySnap.exists ? {} : { createdAt: now }),
            },
            { merge: true }
          );
        }
      });

      return {
        gatewayOrderId: existingGatewayOrderId,
        amountPaise: pricing.amountPaise,
        currency: 'INR',
        keyId,
        subtotal: pricing.subtotal,
        tax: pricing.tax,
        shipping: pricing.shipping,
        total: pricing.total,
        reused: true,
      };
    }

    const receiptRaw =
      typeof preflight.orderNumber === 'string' && preflight.orderNumber.trim()
        ? preflight.orderNumber.trim()
        : orderId;
    const receipt = receiptRaw.slice(0, 40);

    let rzpResp: Response;
    try {
      rzpResp = await fetch(`${RAZORPAY_API_BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          Authorization: razorpayBasicAuthHeader(keyId, keySecret),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: pricing.amountPaise,
          currency: 'INR',
          receipt,
          notes: {
            internalOrderId: orderId,
            uid,
            orderSource: pricing.orderSource,
          },
        }),
      });
    } catch (networkErr) {
      const errName = networkErr instanceof Error ? networkErr.name : '';
      const errMsg = networkErr instanceof Error ? networkErr.message : String(networkErr || '');
      const isTimeoutAmbiguous =
        errName === 'AbortError' ||
        errName === 'TimeoutError' ||
        /timeout|timed out|aborted/i.test(errMsg);
      if (isTimeoutAmbiguous) {
        await markOrderCreationAmbiguousSafely(
          orderRef,
          attemptId,
          `Razorpay Orders API request timed out/aborted: ${errMsg}`
        ).catch(() => null);
        throw new HttpsError(
          'failed-precondition',
          `Razorpay Orders API request ended in an ambiguous state: ${errMsg}`
        );
      }
      await releaseOrderCreationLockSafely(orderRef, attemptId).catch(() => null);
      throw new HttpsError(
        'failed-precondition',
        `Razorpay Orders API request failed: ${errMsg || 'Network error'}`
      );
    }

    if (!rzpResp.ok) {
      const errBody = await rzpResp.text().catch(() => '');
      await releaseOrderCreationLockSafely(orderRef, attemptId).catch(() => null);
      throw new HttpsError(
        'failed-precondition',
        `Razorpay Orders API error (HTTP ${rzpResp.status}): ${errBody.slice(0, 250)}`
      );
    }

    let rzpOrder: RazorpayOrderApiResponse;
    try {
      rzpOrder = (await rzpResp.json()) as RazorpayOrderApiResponse;
    } catch {
      await markOrderCreationAmbiguousSafely(
        orderRef,
        attemptId,
        'Razorpay Orders API returned HTTP 200 with unparseable JSON payload.'
      ).catch(() => null);
      throw new HttpsError(
        'failed-precondition',
        'Razorpay Orders API returned an unparseable response; order marked ambiguous for reconciliation.'
      );
    }

    const gatewayOrderId = typeof rzpOrder.id === 'string' ? rzpOrder.id.trim() : '';
    if (
      !isValidLiveRazorpayOrderId(gatewayOrderId) ||
      Number(rzpOrder.amount) !== pricing.amountPaise ||
      rzpOrder.currency !== 'INR'
    ) {
      await markOrderCreationAmbiguousSafely(
        orderRef,
        attemptId,
        'Razorpay Orders API returned HTTP 200 with invalid or mismatched order payload.'
      ).catch(() => null);
      throw new HttpsError(
        'failed-precondition',
        'Razorpay Orders API returned invalid or mismatched order payload; order marked ambiguous for reconciliation.'
      );
    }

    try {
      await db.runTransaction(async (tx) => {
        const [latestOrderSnap, latestPaySnap] = await Promise.all([
          tx.get(orderRef),
          tx.get(paymentRef),
        ]);
        if (!latestOrderSnap.exists) {
          throw new HttpsError('not-found', 'Order disappeared during Razorpay initialization.');
        }
        const latestOrder = (latestOrderSnap.data() || {}) as Record<string, unknown>;
        const latestPayStatus = String(latestOrder.paymentStatus || '').trim();
        if (TERMINAL_PAYMENT_STATUSES.has(latestPayStatus)) {
          throw new HttpsError(
            'failed-precondition',
            `Order ${orderId} already reached paymentStatus "${latestPayStatus}".`
          );
        }

        const existingSavedOrderId =
          typeof latestOrder.razorpayOrderId === 'string' ? latestOrder.razorpayOrderId.trim() : '';
        const latestLock = latestOrder.razorpayOrderLock as Record<string, unknown> | null | undefined;
        if (
          existingSavedOrderId ||
          !latestLock ||
          latestLock.attemptId !== attemptId ||
          latestLock.status !== 'creating'
        ) {
          throw new HttpsError(
            'aborted',
            `Cannot persist Razorpay order ${gatewayOrderId}: creation attempt ${attemptId} no longer holds the lock.`
          );
        }

        const now = FieldValue.serverTimestamp();
        tx.update(orderRef, {
          razorpayOrderId: gatewayOrderId,
          razorpayAmountPaise: pricing.amountPaise,
          razorpayCurrency: 'INR',
          subtotal: pricing.subtotal,
          tax: pricing.tax,
          shipping: pricing.shipping,
          total: pricing.total,
          razorpayOrderLock: null,
          updatedAt: now,
        });

        const existingPayStatus = latestPaySnap.exists
          ? String(latestPaySnap.data()?.status || '').trim()
          : '';
        if (!TERMINAL_PAYMENT_STATUSES.has(existingPayStatus)) {
          tx.set(
            paymentRef,
            {
              paymentId: orderId,
              orderId,
              uid,
              gateway: 'razorpay_live',
              gatewayOrderId,
              signatureVerified: false,
              amount: pricing.total,
              amountPaise: pricing.amountPaise,
              currency: 'INR',
              status: 'Created',
              updatedAt: now,
              ...(latestPaySnap.exists ? {} : { createdAt: now }),
            },
            { merge: true }
          );
        }
      });
    } catch (persistErr) {
      await markOrderCreationAmbiguousSafely(
        orderRef,
        attemptId,
        `Razorpay order ${gatewayOrderId} was created externally but Firestore persistence failed.`
      ).catch(() => null);
      throw persistErr;
    }

    return {
      gatewayOrderId,
      amountPaise: pricing.amountPaise,
      currency: 'INR',
      keyId,
      subtotal: pricing.subtotal,
      tax: pricing.tax,
      shipping: pricing.shipping,
      total: pricing.total,
      reused: false,
    };
  }
);

// 7. verifyPayment (Atomic + Idempotent + Independent Razorpay Capture Check)
export const verifyPayment = onCall(
  { secrets: [razorpayKeyId, razorpayKeySecret] },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
    const body = (req.data || {}) as Record<string, unknown>;
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const gatewayOrderId = typeof body.gatewayOrderId === 'string' ? body.gatewayOrderId.trim() : '';
    const gatewayPaymentId = typeof body.gatewayPaymentId === 'string' ? body.gatewayPaymentId.trim() : '';
    const signature = typeof body.signature === 'string' ? body.signature.trim() : '';

    if (!orderId || !gatewayOrderId || !gatewayPaymentId || !signature) {
      throw new HttpsError(
        'invalid-argument',
        'orderId, gatewayOrderId, gatewayPaymentId, and signature are all required.'
      );
    }

    if (!isValidLiveRazorpayOrderId(gatewayOrderId) || !isValidLiveRazorpayPaymentId(gatewayPaymentId)) {
      throw new HttpsError(
        'invalid-argument',
        'Rejected synthetic, sandbox, or malformed Razorpay order/payment identifier.'
      );
    }

    const { keyId, keySecret } = requireRazorpayApiCredentials();

    const orderSnap = await db.collection('orders').doc(orderId).get();
    if (!orderSnap.exists) {
      throw new HttpsError('not-found', 'Order missing.');
    }
    const orderData = (orderSnap.data() || {}) as Record<string, unknown>;
    if (orderData.uid !== req.auth.uid) {
      throw new HttpsError('permission-denied', 'You do not own this order.');
    }
    if (orderData.currency !== 'INR') {
      throw new HttpsError('failed-precondition', 'Order currency must be INR.');
    }

    const storedRazorpayOrderId =
      typeof orderData.razorpayOrderId === 'string' ? orderData.razorpayOrderId.trim() : '';
    if (!storedRazorpayOrderId) {
      throw new HttpsError(
        'failed-precondition',
        'Order does not have a server-issued Razorpay order ID.'
      );
    }
    if (gatewayOrderId !== storedRazorpayOrderId) {
      throw new HttpsError(
        'permission-denied',
        'Submitted Razorpay order ID does not match the order record.'
      );
    }

    const rawStoredPaise = orderData.razorpayAmountPaise;
    if (
      typeof rawStoredPaise !== 'number' ||
      !Number.isInteger(rawStoredPaise) ||
      rawStoredPaise < 100
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Order does not have a valid server-computed razorpayAmountPaise.'
      );
    }
    const expectedAmountPaise = rawStoredPaise;

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${storedRazorpayOrderId}|${gatewayPaymentId}`)
      .digest('hex');

    if (!constantTimeHexEquals(signature, expectedSignature)) {
      throw new HttpsError('permission-denied', 'Invalid Razorpay payment signature.');
    }

    const rzpPayment = await fetchRazorpayPaymentById(gatewayPaymentId, keyId, keySecret);
    if (
      rzpPayment.id !== gatewayPaymentId ||
      rzpPayment.order_id !== storedRazorpayOrderId ||
      rzpPayment.currency !== 'INR' ||
      Number(rzpPayment.amount) !== expectedAmountPaise
    ) {
      throw new HttpsError(
        'permission-denied',
        'Razorpay payment details (order_id, currency, or amount) do not match the TapNex order.'
      );
    }
    if (rzpPayment.status !== 'captured') {
      throw new HttpsError(
        'failed-precondition',
        `Razorpay payment status is "${String(rzpPayment.status || 'unknown')}"; only captured payments can be verified.`
      );
    }

    const txResult = await db.runTransaction((tx) =>
      applyVerifiedPaymentInTransaction({
        tx,
        orderId,
        gatewayOrderId: storedRazorpayOrderId,
        gatewayPaymentId,
        expectedAmountPaise,
        verifiedVia: 'verifyPayment',
      })
    );

    if (txResult.outcome === 'conflict') {
      throw new HttpsError('already-exists', txResult.reason || 'Conflicting payment verification detected.');
    }
    if (txResult.outcome === 'terminal_ignored') {
      throw new HttpsError('failed-precondition', txResult.reason || 'Order is in a terminal state.');
    }

    return {
      verified: true,
      alreadyVerified: txResult.outcome === 'already_verified',
      orderId,
      gatewayOrderId: storedRazorpayOrderId,
      gatewayPaymentId,
      amountPaise: expectedAmountPaise,
    };
  }
);

// 8. razorpayWebhook
export const razorpayWebhook = onRequest(
  { secrets: [razorpayWebhookSecret, razorpayKeyId, razorpayKeySecret] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const webhookSecret = razorpayWebhookSecret.value().trim();
    if (!webhookSecret) {
      res.status(500).json({ error: 'RAZORPAY_WEBHOOK_SECRET is not configured.' });
      return;
    }

    const sigHeader = req.headers['x-razorpay-signature'];
    const signature = Array.isArray(sigHeader) ? String(sigHeader[0] || '') : String(sigHeader || '');
    const rawBody = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : typeof req.rawBody === 'string'
        ? Buffer.from(req.rawBody, 'utf8')
        : null;

    if (!rawBody || !signature) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (!constantTimeHexEquals(signature, expectedSignature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const eventIdHeader = req.headers['x-razorpay-event-id'];
    const eventId = (Array.isArray(eventIdHeader) ? String(eventIdHeader[0] || '') : String(eventIdHeader || '')).trim();
    if (!eventId || eventId.length > 200 || eventId.includes('/')) {
      res.status(400).json({ error: 'Valid x-razorpay-event-id header is required.' });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: 'Malformed webhook JSON payload.' });
      return;
    }

    const event = typeof payload.event === 'string' ? payload.event.trim() : '';
    const payloadObj = (payload.payload || {}) as Record<string, unknown>;
    const paymentEntity = ((payloadObj.payment as { entity?: Record<string, unknown> } | undefined)?.entity || {}) as Record<string, unknown>;
    const orderEntity = ((payloadObj.order as { entity?: Record<string, unknown> } | undefined)?.entity || {}) as Record<string, unknown>;

    const eventRef = db.collection('razorpayWebhookEvents').doc(eventId);
    const existingEventSnap = await eventRef.get();
    if (existingEventSnap.exists) {
      res.status(200).json({ received: true, duplicate: true, eventId });
      return;
    }

    if (event === 'payment.captured' || event === 'order.paid') {
      const rzpPaymentId = typeof paymentEntity.id === 'string' ? paymentEntity.id.trim() : '';
      const rzpOrderId = String(paymentEntity.order_id || orderEntity.id || '').trim();

      if (!isValidLiveRazorpayOrderId(rzpOrderId) || !isValidLiveRazorpayPaymentId(rzpPaymentId)) {
        res.status(400).json({ error: 'Webhook missing valid live Razorpay payment/order identifiers.' });
        return;
      }

      if (paymentEntity.status !== 'captured' || paymentEntity.currency !== 'INR') {
        await db.runTransaction(async (tx) => {
          const evSnap = await tx.get(eventRef);
          if (!evSnap.exists) {
            tx.set(eventRef, {
              eventId,
              event,
              gatewayOrderId: rzpOrderId,
              gatewayPaymentId: rzpPaymentId,
              status: 'ignored_uncaptured_entity',
              processedAt: FieldValue.serverTimestamp(),
            });
          }
        });
        res.status(200).json({ received: true, ignored: true, reason: 'Payment entity is not captured in INR.' });
        return;
      }

      let keyId = '';
      let keySecret = '';
      try {
        ({ keyId, keySecret } = requireRazorpayApiCredentials());
      } catch (credErr) {
        res.status(500).json({
          error: credErr instanceof Error ? credErr.message : 'Razorpay credentials not configured.',
        });
        return;
      }

      let verifiedPayment: RazorpayPaymentApiResponse;
      try {
        verifiedPayment = await fetchRazorpayPaymentById(rzpPaymentId, keyId, keySecret);
      } catch (apiErr) {
        res.status(502).json({
          error: apiErr instanceof Error ? apiErr.message : 'Failed to verify payment with Razorpay API.',
        });
        return;
      }

      if (
        verifiedPayment.id !== rzpPaymentId ||
        verifiedPayment.order_id !== rzpOrderId ||
        verifiedPayment.currency !== 'INR' ||
        verifiedPayment.status !== 'captured'
      ) {
        await db.runTransaction(async (tx) => {
          const evSnap = await tx.get(eventRef);
          if (!evSnap.exists) {
            tx.set(eventRef, {
              eventId,
              event,
              gatewayOrderId: rzpOrderId,
              gatewayPaymentId: rzpPaymentId,
              status: 'rejected_api_verification',
              processedAt: FieldValue.serverTimestamp(),
            });
          }
        });
        res.status(400).json({ error: 'Razorpay API payment state is not captured for this order.' });
        return;
      }

      const verifiedAmountPaise = Number(verifiedPayment.amount);
      if (!Number.isInteger(verifiedAmountPaise) || verifiedAmountPaise < 100) {
        res.status(400).json({ error: 'Invalid payment amount returned by Razorpay API.' });
        return;
      }

      const ordersSnap = await db.collection('orders').where('razorpayOrderId', '==', rzpOrderId).limit(2).get();

      const outcome = await db.runTransaction(async (tx) => {
        const evSnap = await tx.get(eventRef);
        if (evSnap.exists) {
          return { statusCode: 200, body: { received: true, duplicate: true, eventId } };
        }

        if (ordersSnap.empty) {
          tx.set(eventRef, {
            eventId,
            event,
            gatewayOrderId: rzpOrderId,
            gatewayPaymentId: rzpPaymentId,
            status: 'ignored_order_not_found',
            processedAt: FieldValue.serverTimestamp(),
          });
          return { statusCode: 200, body: { received: true, ignored: true, eventId } };
        }

        if (ordersSnap.size > 1) {
          tx.set(eventRef, {
            eventId,
            event,
            gatewayOrderId: rzpOrderId,
            gatewayPaymentId: rzpPaymentId,
            status: 'error_ambiguous_order',
            processedAt: FieldValue.serverTimestamp(),
          });
          return { statusCode: 409, body: { error: 'Multiple TapNex orders match razorpayOrderId.' } };
        }

        const matchedDoc = ordersSnap.docs[0];
        const orderId = matchedDoc.id;
        const orderData = (matchedDoc.data() || {}) as Record<string, unknown>;
        const expectedAmountPaise = orderData.razorpayAmountPaise;
        if (
          typeof expectedAmountPaise !== 'number' ||
          !Number.isInteger(expectedAmountPaise) ||
          expectedAmountPaise < 100 ||
          orderData.currency !== 'INR' ||
          verifiedAmountPaise !== expectedAmountPaise
        ) {
          tx.set(eventRef, {
            eventId,
            event,
            orderId,
            gatewayOrderId: rzpOrderId,
            gatewayPaymentId: rzpPaymentId,
            status: 'rejected_amount_mismatch',
            expectedAmountPaise,
            receivedAmountPaise: verifiedAmountPaise,
            processedAt: FieldValue.serverTimestamp(),
          });
          return { statusCode: 400, body: { error: 'Payment amount or currency mismatch.' } };
        }

        const applyRes = await applyVerifiedPaymentInTransaction({
          tx,
          orderId,
          gatewayOrderId: rzpOrderId,
          gatewayPaymentId: rzpPaymentId,
          expectedAmountPaise,
          verifiedVia: 'razorpayWebhook',
          webhookEventId: eventId,
        });

        if (applyRes.outcome === 'conflict') {
          tx.set(eventRef, {
            eventId,
            event,
            orderId,
            gatewayOrderId: rzpOrderId,
            gatewayPaymentId: rzpPaymentId,
            status: 'conflict_different_payment',
            reason: applyRes.reason || '',
            processedAt: FieldValue.serverTimestamp(),
          });
          return { statusCode: 409, body: { error: applyRes.reason || 'Payment conflict.' } };
        }

        if (applyRes.outcome === 'terminal_ignored') {
          tx.set(eventRef, {
            eventId,
            event,
            orderId,
            gatewayOrderId: rzpOrderId,
            gatewayPaymentId: rzpPaymentId,
            status: 'ignored_terminal_order',
            reason: applyRes.reason || '',
            processedAt: FieldValue.serverTimestamp(),
          });
          return { statusCode: 200, body: { received: true, ignored: true, eventId } };
        }

        tx.set(eventRef, {
          eventId,
          event,
          orderId,
          gatewayOrderId: rzpOrderId,
          gatewayPaymentId: rzpPaymentId,
          amountPaise: expectedAmountPaise,
          status: applyRes.outcome === 'already_verified' ? 'already_verified' : 'processed_paid',
          processedAt: FieldValue.serverTimestamp(),
        });

        return {
          statusCode: 200,
          body: {
            received: true,
            eventId,
            orderId,
            alreadyVerified: applyRes.outcome === 'already_verified',
          },
        };
      });

      res.status(outcome.statusCode).json(outcome.body);
      return;
    }

    if (event === 'payment.failed') {
      const rzpPaymentId = typeof paymentEntity.id === 'string' ? paymentEntity.id.trim() : '';
      const rzpOrderId = String(paymentEntity.order_id || '').trim();
      const ordersSnap = rzpOrderId
        ? await db.collection('orders').where('razorpayOrderId', '==', rzpOrderId).limit(1).get()
        : null;

      await db.runTransaction(async (tx) => {
        const evSnap = await tx.get(eventRef);
        if (evSnap.exists) return;

        if (!ordersSnap || ordersSnap.empty) {
          tx.set(eventRef, {
            eventId,
            event,
            gatewayOrderId: rzpOrderId,
            gatewayPaymentId: rzpPaymentId,
            status: 'ignored_order_not_found',
            processedAt: FieldValue.serverTimestamp(),
          });
          return;
        }

        const matchedRef = ordersSnap.docs[0].ref;
        const orderId = matchedRef.id;
        const paymentRef = db.collection('payments').doc(orderId);
        const [latestOrderSnap, latestPaySnap] = await Promise.all([
          tx.get(matchedRef),
          tx.get(paymentRef),
        ]);
        const latestOrder = (latestOrderSnap.data() || {}) as Record<string, unknown>;
        const currentPaymentStatus = String(latestOrder.paymentStatus || '').trim();
        const currentOrderStatus = String(latestOrder.orderStatus || '').trim();

        const isAlreadyPaidOrProgressed =
          currentPaymentStatus === 'Verified' ||
          currentPaymentStatus === 'Completed' ||
          currentPaymentStatus === 'Refunded' ||
          PROGRESSED_ORDER_STATUSES.has(currentOrderStatus);

        if (isAlreadyPaidOrProgressed) {
          tx.set(eventRef, {
            eventId,
            event,
            orderId,
            gatewayOrderId: rzpOrderId,
            gatewayPaymentId: rzpPaymentId,
            status: 'ignored_already_paid_out_of_order',
            processedAt: FieldValue.serverTimestamp(),
          });
          return;
        }

        const now = FieldValue.serverTimestamp();
        const failureReason = String(
          paymentEntity.error_description || paymentEntity.error_reason || 'Payment failed'
        ).slice(0, 200);

        tx.update(matchedRef, {
          paymentStatus: 'Failed',
          lastPaymentFailureReason: failureReason,
          updatedAt: now,
        });

        tx.set(
          paymentRef,
          {
            paymentId: orderId,
            orderId,
            uid: latestOrder.uid || '',
            gateway: 'razorpay_live',
            gatewayOrderId: rzpOrderId,
            ...(rzpPaymentId ? { gatewayPaymentId: rzpPaymentId } : {}),
            signatureVerified: false,
            amount: latestOrder.total || 0,
            currency: 'INR',
            status: 'Failed',
            failureReason,
            lastWebhookEventId: eventId,
            updatedAt: now,
            ...(latestPaySnap.exists ? {} : { createdAt: now }),
          },
          { merge: true }
        );

        tx.set(eventRef, {
          eventId,
          event,
          orderId,
          gatewayOrderId: rzpOrderId,
          gatewayPaymentId: rzpPaymentId,
          status: 'processed_failed',
          processedAt: FieldValue.serverTimestamp(),
        });
      });

      res.status(200).json({ received: true, eventId });
      return;
    }

    // All other events (e.g., payment.authorized, order.created) are logged durably and NEVER mark paid
    await db.runTransaction(async (tx) => {
      const evSnap = await tx.get(eventRef);
      if (!evSnap.exists) {
        tx.set(eventRef, {
          eventId,
          event,
          status: 'ignored_event_type',
          processedAt: FieldValue.serverTimestamp(),
        });
      }
    });
    res.status(200).json({ received: true, ignored: true, event, eventId });
  }
);

// 9. generatePurchasedQr
export const generatePurchasedQr = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const uid = req.auth.uid;
  const orderId = typeof req.data?.orderId === 'string' ? req.data.orderId.trim() : '';
  if (!orderId || orderId.length > 128 || orderId.includes('/')) {
    throw new HttpsError('invalid-argument', 'Valid orderId is required.');
  }

  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HttpsError('not-found', 'Order not found.');
  }
  const orderData = (orderSnap.data() || {}) as Record<string, unknown>;
  if (orderData.uid !== uid) {
    throw new HttpsError('permission-denied', 'You do not own this order.');
  }
  if (orderData.paymentStatus !== 'Verified') {
    throw new HttpsError('failed-precondition', 'Payment must be verified before QR generation.');
  }

  let slug = sanitizeSlug(orderData.profileSlug);
  const isShopOrder = orderData.orderSource === 'shop' || orderData.designId === 'shop_direct';
  const profileId = typeof orderData.profileId === 'string' ? orderData.profileId.trim() : '';

  if (!slug && profileId && profileId !== 'shop_cart') {
    const profSnap = await db.collection('profiles').doc(profileId).get();
    if (profSnap.exists && profSnap.data()?.uid === uid) {
      slug = sanitizeSlug(profSnap.data()?.slug);
    }
  }

  if (
    !slug ||
    slug.length < 3 ||
    slug.length > 64 ||
    !/^[a-z0-9-]+$/.test(slug) ||
    slug === 'undefined' ||
    slug === 'null' ||
    slug === 'shop-cart' ||
    (isShopOrder && (!profileId || profileId === 'shop_cart') && !orderData.profileSlug)
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Order does not have a valid linked profileSlug for QR generation.'
    );
  }

  const qrRef = db.collection('qrCodes').doc(orderId);
  const existingQrSnap = await qrRef.get();
  if (existingQrSnap.exists) {
    const existingQr = (existingQrSnap.data() || {}) as Record<string, unknown>;
    const existingTargetUrl = typeof existingQr.targetUrl === 'string' ? existingQr.targetUrl.trim() : '';
    if (existingTargetUrl && !existingTargetUrl.endsWith('/p/undefined')) {
      if (orderData.qrCodeId !== orderId) {
        await orderRef.update({
          qrCodeId: orderId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return { qrCodeId: orderId, targetUrl: existingTargetUrl, alreadyExists: true };
    }
  }

  const baseUrl = (process.env.APP_URL || 'https://tapnex.in').replace(/\/+$/, '');
  const targetUrl = `${baseUrl}/p/${slug}`;
  const svgContent = await QRCode.toString(targetUrl, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 4,
  });
  const pngBuffer = await QRCode.toBuffer(targetUrl, {
    errorCorrectionLevel: 'H',
    margin: 4,
    width: 1024,
  });
  const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  const storagePath = `qrCodes/${orderId}/qr.png`;
  await storage.bucket().file(storagePath).save(pngBuffer, { contentType: 'image/png' });

  const txOutcome = await db.runTransaction(async (tx) => {
    const [latestOrderSnap, latestQrSnap] = await Promise.all([tx.get(orderRef), tx.get(qrRef)]);
    if (!latestOrderSnap.exists) {
      throw new HttpsError('not-found', 'Order not found.');
    }
    const latestOrder = (latestOrderSnap.data() || {}) as Record<string, unknown>;
    if (latestOrder.uid !== uid) {
      throw new HttpsError('permission-denied', 'You do not own this order.');
    }
    if (latestOrder.paymentStatus !== 'Verified') {
      throw new HttpsError('failed-precondition', 'Payment must be verified before QR generation.');
    }

    const now = FieldValue.serverTimestamp();
    if (latestQrSnap.exists) {
      const existingData = (latestQrSnap.data() || {}) as Record<string, unknown>;
      const existingUrl = typeof existingData.targetUrl === 'string' ? existingData.targetUrl.trim() : '';
      if (existingUrl && !existingUrl.endsWith('/p/undefined')) {
        if (latestOrder.qrCodeId !== orderId) {
          tx.update(orderRef, {
            qrCodeId: orderId,
            updatedAt: now,
          });
        }
        return { qrCodeId: orderId, targetUrl: existingUrl, alreadyExists: true };
      }
    }

    tx.set(qrRef, {
      qrCodeId: orderId,
      uid: latestOrder.uid,
      orderId,
      printerId: typeof latestOrder.printerId === 'string' ? latestOrder.printerId : '',
      targetUrl,
      svgContent,
      pngDataUrl,
      storagePath,
      format: 'PNG_SVG',
      qrType: 'CUSTOMER_ORDER',
      version: 1,
      createdBy: uid,
      createdAt: now,
    });
    tx.update(orderRef, {
      qrCodeId: orderId,
      printFileReady: true,
      updatedAt: now,
    });
    return { qrCodeId: orderId, targetUrl, alreadyExists: false };
  });

  return txOutcome;
});

const ALL_ORDER_STATUSES = new Set([
  'Design Pending',
  'Design Approved',
  'Awaiting Payment',
  'Payment Successful',
  'Processing',
  'Assigned to Printer',
  'Printing in Progress',
  'Quality Check',
  'Ready for Dispatch',
  'Dispatched',
  'In Transit',
  'Delivered',
  'Cancelled',
  'Refunded',
]);

const PRINTER_ALLOWED_ORDER_STATUSES = new Set([
  'Processing',
  'Assigned to Printer',
  'Printing in Progress',
  'Quality Check',
  'Ready for Dispatch',
  'Dispatched',
  'In Transit',
  'Delivered',
]);

const ALLOWED_RECONCILE_PAYMENT_STATUSES = new Set([
  'Pending',
  'Completed',
  'Verified',
  'Rejected',
  'Failed',
  'Refunded',
]);

// 10. generateAdminQr
export const generateAdminQr = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['SUPERADMIN', 'ADMIN']);
  const actorEmail = typeof req.auth.token?.email === 'string' ? req.auth.token.email : '';
  const data = (req.data || {}) as {
    targetUrl?: unknown;
    customerName?: unknown;
    orderId?: unknown;
    description?: unknown;
  };

  const targetUrl = normalizePublicHttpUrl(data.targetUrl);
  const customerName = typeof data.customerName === 'string' ? data.customerName.trim().slice(0, 120) : '';
  const orderId = typeof data.orderId === 'string' ? data.orderId.trim().slice(0, 128) : '';
  if (orderId.includes('/')) {
    throw new HttpsError('invalid-argument', 'orderId reference cannot contain "/".');
  }
  const description = typeof data.description === 'string' ? data.description.trim().slice(0, 400) : '';

  const qrRef = db.collection('qrCodes').doc();
  const storagePath = `qrCodes/${qrRef.id}/qr.png`;
  const { svgContent, pngDataUrl } = await generateServerQrArtwork({ targetUrl, storagePath });

  const now = FieldValue.serverTimestamp();
  await qrRef.set({
    qrCodeId: qrRef.id,
    orderId,
    targetUrl,
    svgContent,
    pngDataUrl,
    storagePath,
    format: 'PNG_SVG',
    qrType: 'ADMIN_CUSTOM',
    customerName,
    description,
    version: 1,
    createdBy: req.auth.uid,
    createdAt: now,
  });

  await writeAuditLog({
    actorUid: req.auth.uid,
    actorEmail,
    actorRole,
    action: 'GENERATE_ADMIN_QR',
    targetCollection: 'qrCodes',
    targetId: qrRef.id,
    details: `Generated admin QR for ${targetUrl}`,
  });

  return {
    qrCodeId: qrRef.id,
    orderId,
    targetUrl,
    svgContent,
    pngDataUrl,
    storagePath,
    format: 'PNG_SVG',
    qrType: 'ADMIN_CUSTOM',
    customerName,
    description,
    version: 1,
    createdBy: req.auth.uid,
  };
});

// 11. generatePrintReadyPdf (Exact 85.6x54mm + 3mm bleed)
export const generatePrintReadyPdf = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  await assertRole(req.auth, ['PRINTER', 'ADMIN', 'SUPERADMIN']);
  const orderId = assertValidDocId((req.data as { orderId?: unknown })?.orderId, 'orderId');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [91.6, 60] });
  doc.setFillColor(11, 29, 58);
  doc.rect(0, 0, 91.6, 60, 'F');
  doc.addPage([91.6, 60], 'landscape');
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 91.6, 60, 'F');
  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  const path = `printFiles/${orderId}/card-print-300dpi.pdf`;
  await storage.bucket().file(path).save(pdfBuffer, { contentType: 'application/pdf' });
  await db.collection('orders').doc(orderId).update({ printFileReady: true, updatedAt: FieldValue.serverTimestamp() });
  return { storagePath: path, dimensions: '85.6x54mm+3mm_bleed' };
});

// 12. assignPrinter
export const assignPrinter = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['ADMIN', 'SUPERADMIN']);
  const actorEmail = typeof req.auth.token?.email === 'string' ? req.auth.token.email : '';
  const data = (req.data || {}) as { orderId?: unknown; printerId?: unknown };
  const orderId = assertValidDocId(data.orderId, 'orderId');
  const printerId = assertValidDocId(data.printerId, 'printerId');

  if (printerId !== 'admin_inhouse') {
    const printerSnap = await db.collection('printers').doc(printerId).get();
    if (!printerSnap.exists || printerSnap.data()?.status !== 'Active') {
      throw new HttpsError('failed-precondition', `Printer ${printerId} is not active.`);
    }
  }

  const orderRef = db.collection('orders').doc(orderId);
  const qrRef = db.collection('qrCodes').doc(orderId);

  const result = await db.runTransaction(async (tx) => {
    const [orderSnap, qrSnap] = await Promise.all([tx.get(orderRef), tx.get(qrRef)]);
    if (!orderSnap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found.`);
    }
    const existingOrder = (orderSnap.data() || {}) as Record<string, unknown>;
    const currentStatus = String(existingOrder.orderStatus || '');
    const preserveStatuses = new Set([
      'Printing in Progress',
      'Quality Check',
      'Ready for Dispatch',
      'Dispatched',
      'In Transit',
      'Delivered',
      'Cancelled',
      'Refunded',
    ]);
    const nextOrderStatus = preserveStatuses.has(currentStatus) ? currentStatus : 'Assigned to Printer';
    const now = FieldValue.serverTimestamp();

    tx.update(orderRef, {
      printerId,
      orderStatus: nextOrderStatus,
      updatedAt: now,
    });
    if (qrSnap.exists) {
      tx.update(qrRef, { printerId });
    }
    return { orderId, printerId, orderStatus: nextOrderStatus };
  });

  await writeAuditLog({
    actorUid: req.auth.uid,
    actorEmail,
    actorRole,
    action: 'ASSIGN_PRINTER',
    targetCollection: 'orders',
    targetId: orderId,
    details: `Assigned to printer ${printerId} (status=${result.orderStatus})`,
  });
  return result;
});

// 13. updateOrderStatus
export const updateOrderStatus = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['PRINTER', 'ADMIN', 'SUPERADMIN']);
  const actorEmail = typeof req.auth.token?.email === 'string' ? req.auth.token.email : '';
  const data = (req.data || {}) as { orderId?: unknown; orderStatus?: unknown };
  const orderId = assertValidDocId(data.orderId, 'orderId');
  const orderStatus = typeof data.orderStatus === 'string' ? data.orderStatus.trim() : '';

  if (!ALL_ORDER_STATUSES.has(orderStatus)) {
    throw new HttpsError('invalid-argument', `Unsupported orderStatus "${orderStatus}".`);
  }
  if (orderStatus === 'Payment Successful' || orderStatus === 'Refunded') {
    throw new HttpsError(
      'failed-precondition',
      `Status "${orderStatus}" affects payment state and must be updated via payment verification or adminReconcileOrderPayment.`
    );
  }
  if (actorRole === 'PRINTER' && !PRINTER_ALLOWED_ORDER_STATUSES.has(orderStatus)) {
    throw new HttpsError(
      'permission-denied',
      `Printer role is not allowed to set orderStatus "${orderStatus}".`
    );
  }

  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HttpsError('not-found', `Order ${orderId} not found.`);
  }
  if (actorRole === 'PRINTER' && orderSnap.data()?.printerId !== req.auth.uid) {
    throw new HttpsError('permission-denied', 'Printer can only update assigned orders.');
  }

  await orderRef.update({
    orderStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({
    actorUid: req.auth.uid,
    actorEmail,
    actorRole,
    action: 'UPDATE_ORDER_STATUS',
    targetCollection: 'orders',
    targetId: orderId,
    details: `Order status set to ${orderStatus}`,
  });
  return { orderId, orderStatus };
});

// 20. adminReconcileOrderPayment (Explicit, audited server-only payment reconciliation)
export const adminReconcileOrderPayment = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['ADMIN', 'SUPERADMIN']);
  const actorEmail = typeof req.auth.token?.email === 'string' ? req.auth.token.email : '';
  const data = (req.data || {}) as {
    orderId?: unknown;
    paymentStatus?: unknown;
    orderStatus?: unknown;
    reason?: unknown;
    gatewayReference?: unknown;
  };

  const orderId = assertValidDocId(data.orderId, 'orderId');
  const paymentStatus = typeof data.paymentStatus === 'string' ? data.paymentStatus.trim() : '';
  if (!ALLOWED_RECONCILE_PAYMENT_STATUSES.has(paymentStatus)) {
    throw new HttpsError('invalid-argument', `Invalid paymentStatus "${paymentStatus}".`);
  }

  const requestedOrderStatus =
    typeof data.orderStatus === 'string' && data.orderStatus.trim() ? data.orderStatus.trim() : '';
  if (requestedOrderStatus && !ALL_ORDER_STATUSES.has(requestedOrderStatus)) {
    throw new HttpsError('invalid-argument', `Invalid orderStatus "${requestedOrderStatus}".`);
  }

  const cleanReason = typeof data.reason === 'string' ? data.reason.trim().slice(0, 400) : '';
  if (cleanReason.length < 3) {
    throw new HttpsError(
      'invalid-argument',
      'An explicit reconciliation reason (at least 3 characters) is required.'
    );
  }
  const cleanGatewayRef =
    typeof data.gatewayReference === 'string' ? data.gatewayReference.trim().slice(0, 128) : '';

  const orderRef = db.collection('orders').doc(orderId);
  const paymentRef = db.collection('payments').doc(orderId);

  const txResult = await db.runTransaction(async (tx) => {
    const [orderSnap, paymentSnap] = await Promise.all([tx.get(orderRef), tx.get(paymentRef)]);
    if (!orderSnap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found.`);
    }
    const orderData = (orderSnap.data() || {}) as Record<string, unknown>;
    const existingPaymentData = (paymentSnap.data() || {}) as Record<string, unknown>;

    const profileId = typeof orderData.profileId === 'string' ? orderData.profileId.trim() : '';
    const profileRef =
      profileId && profileId !== 'shop_cart' && /^[a-zA-Z0-9_-]+$/.test(profileId)
        ? db.collection('profiles').doc(profileId)
        : null;
    const profileSnap = profileRef ? await tx.get(profileRef) : null;

    const resolvedSlug = sanitizeSlug(
      orderData.profileSlug || (profileSnap?.exists ? profileSnap.data()?.slug : '')
    );
    const publicProfileRef = resolvedSlug ? db.collection('publicProfiles').doc(resolvedSlug) : null;
    const publicProfileSnap = publicProfileRef ? await tx.get(publicProfileRef) : null;

    const currentPaymentStatus = String(orderData.paymentStatus || 'Pending');
    const currentOrderStatus = String(orderData.orderStatus || 'Awaiting Payment');
    const isPaid = paymentStatus === 'Verified' || paymentStatus === 'Completed';

    const nextOrderStatus = requestedOrderStatus
      ? requestedOrderStatus
      : isPaid
        ? currentOrderStatus === 'Awaiting Payment' ||
          currentOrderStatus === 'Design Pending' ||
          currentOrderStatus === 'Design Approved'
          ? 'Payment Successful'
          : currentOrderStatus
        : paymentStatus === 'Refunded'
          ? 'Refunded'
          : paymentStatus === 'Rejected'
            ? 'Cancelled'
            : currentOrderStatus;

    const now = FieldValue.serverTimestamp();
    const totalInr = typeof orderData.total === 'number' && Number.isFinite(orderData.total) ? orderData.total : 0;
    const amountPaise = Math.round(totalInr * 100);

    tx.update(orderRef, {
      paymentStatus,
      orderStatus: nextOrderStatus,
      updatedAt: now,
    });

    tx.set(
      paymentRef,
      {
        paymentId: orderId,
        orderId,
        uid: orderData.uid || '',
        gateway:
          typeof existingPaymentData.gateway === 'string' && existingPaymentData.gateway
            ? existingPaymentData.gateway
            : 'razorpay_live',
        gatewayOrderId:
          cleanGatewayRef ||
          (typeof existingPaymentData.gatewayOrderId === 'string' && existingPaymentData.gatewayOrderId) ||
          (typeof orderData.razorpayOrderId === 'string' && orderData.razorpayOrderId) ||
          `admin_reconcile_${orderId}`,
        signatureVerified: Boolean(existingPaymentData.signatureVerified),
        amount: totalInr,
        amountPaise,
        currency: 'INR',
        status: paymentStatus,
        verifiedVia: 'adminReconciliation',
        reconciledByUid: req.auth!.uid,
        reconciledByEmail: actorEmail,
        reconciliationReason: cleanReason,
        ...(isPaid ? { verifiedAt: now } : {}),
        updatedAt: now,
        ...(paymentSnap.exists ? {} : { createdAt: now }),
      },
      { merge: true }
    );

    if (profileRef && profileSnap?.exists) {
      const profileData = (profileSnap.data() || {}) as Record<string, unknown>;
      if (isPaid && !profileData.adminDisabled) {
        tx.update(profileRef, {
          paymentConfirmed: true,
          isPublic: true,
          updatedAt: now,
        });
      } else if (!isPaid && profileData.paymentConfirmed) {
        tx.update(profileRef, {
          paymentConfirmed: false,
          updatedAt: now,
        });
      }
    }

    if (publicProfileRef && publicProfileSnap?.exists) {
      const pubData = (publicProfileSnap.data() || {}) as Record<string, unknown>;
      if (isPaid && !pubData.adminDisabled) {
        tx.update(publicProfileRef, {
          paymentConfirmed: true,
          isPublic: true,
          lastPaidOrderId: orderId,
          updatedAt: now,
        });
      } else if (!isPaid) {
        tx.update(publicProfileRef, {
          paymentConfirmed: false,
          lastPaidOrderId: '',
          updatedAt: now,
        });
      }
    }

    return {
      orderId,
      orderNumber: String(orderData.orderNumber || orderId),
      previousPaymentStatus: currentPaymentStatus,
      previousOrderStatus: currentOrderStatus,
      paymentStatus,
      orderStatus: nextOrderStatus,
    };
  });

  await writeAuditLog({
    actorUid: req.auth.uid,
    actorEmail,
    actorRole,
    action: 'ADMIN_RECONCILE_ORDER_PAYMENT',
    targetCollection: 'orders',
    targetId: orderId,
    details: `Order ${txResult.orderNumber}: paymentStatus ${txResult.previousPaymentStatus} -> ${txResult.paymentStatus}, orderStatus ${txResult.previousOrderStatus} -> ${txResult.orderStatus}. Reason: ${cleanReason}`,
  });

  return {
    orderId: txResult.orderId,
    paymentStatus: txResult.paymentStatus,
    orderStatus: txResult.orderStatus,
  };
});

// 21. adminReconcileProfilePayment (Server-only profile unlock/revoke for verified admin)
export const adminReconcileProfilePayment = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['ADMIN', 'SUPERADMIN']);
  const actorEmail = typeof req.auth.token?.email === 'string' ? req.auth.token.email : '';
  const data = (req.data || {}) as {
    profileId?: unknown;
    completed?: unknown;
    reference?: unknown;
    reason?: unknown;
  };

  const profileId = assertValidDocId(data.profileId, 'profileId');
  const completed = data.completed === undefined ? true : Boolean(data.completed);
  const reference = typeof data.reference === 'string' ? data.reference.trim().slice(0, 128) : '';
  const reason =
    typeof data.reason === 'string' && data.reason.trim()
      ? data.reason.trim().slice(0, 400)
      : completed
        ? 'Admin profile payment reconciliation'
        : 'Admin revoked profile payment status';

  const profileRef = db.collection('profiles').doc(profileId);
  const completedAt = completed ? new Date().toISOString() : '';

  const outcome = await db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap.exists) {
      throw new HttpsError('not-found', `Profile ${profileId} not found.`);
    }
    const profileData = (profileSnap.data() || {}) as Record<string, unknown>;
    const slug = sanitizeSlug(profileData.slug);
    const pubRef = slug ? db.collection('publicProfiles').doc(slug) : null;
    const pubSnap = pubRef ? await tx.get(pubRef) : null;

    const now = FieldValue.serverTimestamp();
    const nextIsPublic = completed && !profileData.adminDisabled ? true : Boolean(profileData.isPublic);

    tx.update(profileRef, {
      paymentConfirmed: completed,
      paymentCompletedAt: completedAt,
      paymentReference: reference,
      isPublic: nextIsPublic,
      updatedAt: now,
    });

    if (pubRef && pubSnap?.exists) {
      tx.update(pubRef, {
        paymentConfirmed: completed,
        paymentCompletedAt: completedAt,
        isPublic: completed && !pubSnap.data()?.adminDisabled ? true : Boolean(pubSnap.data()?.isPublic),
        updatedAt: now,
      });
    } else if (pubRef) {
      tx.set(pubRef, {
        slug,
        profileId,
        uid: profileData.uid || '',
        profileType: profileData.profileType || 'adult',
        isPublic: nextIsPublic,
        personalInformation: profileData.personalInformation || {},
        socialLinks: Array.isArray(profileData.socialLinks) ? profileData.socialLinks : [],
        customFields: Array.isArray(profileData.customFields) ? profileData.customFields : [],
        themeColor: '#0B1D3A',
        paymentConfirmed: completed,
        paymentCompletedAt: completedAt,
        adminDisabled: Boolean(profileData.adminDisabled),
        adminApproved: Boolean(profileData.adminApproved),
        updatedAt: now,
      });
    }

    return {
      profileId,
      slug,
      previousPaymentConfirmed: Boolean(profileData.paymentConfirmed),
      paymentConfirmed: completed,
      paymentCompletedAt: completedAt,
      paymentReference: reference,
      isPublic: nextIsPublic,
    };
  });

  await writeAuditLog({
    actorUid: req.auth.uid,
    actorEmail,
    actorRole,
    action: completed ? 'MARK_PROFILE_PAYMENT_COMPLETED' : 'REVOKE_PROFILE_PAYMENT_STATUS',
    targetCollection: 'profiles',
    targetId: profileId,
    details: `/p/${outcome.slug}: paymentConfirmed ${outcome.previousPaymentConfirmed} -> ${completed}${reference ? ` (Ref: ${reference})` : ''}. Reason: ${reason}`,
  });

  return {
    profileId: outcome.profileId,
    slug: outcome.slug,
    paymentConfirmed: outcome.paymentConfirmed,
    paymentCompletedAt: outcome.paymentCompletedAt,
    paymentReference: outcome.paymentReference,
    isPublic: outcome.isPublic,
  };
});

// 22. adminEnsureOrderQr (Admin server-only CUSTOMER_ORDER QR preparation for paid orders)
export const adminEnsureOrderQr = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['ADMIN', 'SUPERADMIN']);
  const actorEmail = typeof req.auth.token?.email === 'string' ? req.auth.token.email : '';
  const orderId = assertValidDocId((req.data as { orderId?: unknown })?.orderId, 'orderId');

  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HttpsError('not-found', `Order ${orderId} not found.`);
  }
  const orderData = (orderSnap.data() || {}) as Record<string, unknown>;
  const paymentStatus = String(orderData.paymentStatus || '');
  if (paymentStatus !== 'Verified' && paymentStatus !== 'Completed') {
    throw new HttpsError(
      'failed-precondition',
      `Order ${orderId} paymentStatus is "${paymentStatus}". Payment must be Verified or Completed before generating CUSTOMER_ORDER QR artwork.`
    );
  }

  let slug = sanitizeSlug(orderData.profileSlug);
  const profileId = typeof orderData.profileId === 'string' ? orderData.profileId.trim() : '';
  if (!slug && profileId && profileId !== 'shop_cart') {
    const profSnap = await db.collection('profiles').doc(profileId).get();
    if (profSnap.exists) {
      slug = sanitizeSlug(profSnap.data()?.slug);
    }
  }
  if (!slug || slug.length < 3 || slug.length > 64 || !/^[a-z0-9-]+$/.test(slug) || slug === 'undefined' || slug === 'null' || slug === 'shop-cart') {
    throw new HttpsError(
      'failed-precondition',
      `Order ${orderId} is missing a valid linked profileSlug for QR generation.`
    );
  }

  const qrRef = db.collection('qrCodes').doc(orderId);
  const existingQrSnap = await qrRef.get();
  if (existingQrSnap.exists) {
    const existingQr = (existingQrSnap.data() || {}) as Record<string, unknown>;
    const existingTargetUrl = typeof existingQr.targetUrl === 'string' ? existingQr.targetUrl.trim() : '';
    const existingPng = typeof existingQr.pngDataUrl === 'string' ? existingQr.pngDataUrl : '';
    const existingSvg = typeof existingQr.svgContent === 'string' ? existingQr.svgContent : '';
    if (existingTargetUrl && !existingTargetUrl.endsWith('/p/undefined') && existingPng && existingSvg) {
      if (orderData.qrCodeId !== orderId || orderData.printFileReady !== true) {
        await orderRef.update({
          qrCodeId: orderId,
          printFileReady: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return {
        qrCodeId: orderId,
        uid: String(existingQr.uid || orderData.uid || ''),
        orderId,
        printerId: String(existingQr.printerId || orderData.printerId || ''),
        targetUrl: existingTargetUrl,
        svgContent: existingSvg,
        pngDataUrl: existingPng,
        storagePath: String(existingQr.storagePath || `qrCodes/${orderId}/qr.png`),
        format: 'PNG_SVG',
        qrType: String(existingQr.qrType || 'CUSTOMER_ORDER'),
        version: Number(existingQr.version || 1),
        createdBy: String(existingQr.createdBy || req.auth.uid),
        alreadyExists: true,
      };
    }
  }

  const baseUrl = (process.env.APP_URL || 'https://tapnex.in').replace(/\/+$/, '');
  const targetUrl = `${baseUrl}/p/${slug}`;
  const storagePath = `qrCodes/${orderId}/qr.png`;
  const { svgContent, pngDataUrl } = await generateServerQrArtwork({ targetUrl, storagePath });

  const txOutcome = await db.runTransaction(async (tx) => {
    const [latestOrderSnap, latestQrSnap] = await Promise.all([tx.get(orderRef), tx.get(qrRef)]);
    if (!latestOrderSnap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found.`);
    }
    const latestOrder = (latestOrderSnap.data() || {}) as Record<string, unknown>;
    const latestPay = String(latestOrder.paymentStatus || '');
    if (latestPay !== 'Verified' && latestPay !== 'Completed') {
      throw new HttpsError(
        'failed-precondition',
        'Order payment must be Verified or Completed before QR generation.'
      );
    }

    const now = FieldValue.serverTimestamp();
    if (latestQrSnap.exists) {
      const existingData = (latestQrSnap.data() || {}) as Record<string, unknown>;
      const existingUrl = typeof existingData.targetUrl === 'string' ? existingData.targetUrl.trim() : '';
      const exPng = typeof existingData.pngDataUrl === 'string' ? existingData.pngDataUrl : '';
      if (existingUrl && !existingUrl.endsWith('/p/undefined') && exPng) {
        if (latestOrder.qrCodeId !== orderId || latestOrder.printFileReady !== true) {
          tx.update(orderRef, {
            qrCodeId: orderId,
            printFileReady: true,
            updatedAt: now,
          });
        }
        return {
          qrCodeId: orderId,
          uid: String(existingData.uid || latestOrder.uid || ''),
          orderId,
          printerId: String(existingData.printerId || latestOrder.printerId || ''),
          targetUrl: existingUrl,
          svgContent: String(existingData.svgContent || svgContent),
          pngDataUrl: exPng,
          storagePath: String(existingData.storagePath || storagePath),
          format: 'PNG_SVG' as const,
          qrType: String(existingData.qrType || 'CUSTOMER_ORDER'),
          version: Number(existingData.version || 1),
          createdBy: String(existingData.createdBy || req.auth!.uid),
          alreadyExists: true,
        };
      }
    }

    const qrDocPayload = {
      qrCodeId: orderId,
      uid: String(latestOrder.uid || ''),
      orderId,
      printerId: typeof latestOrder.printerId === 'string' ? latestOrder.printerId : '',
      targetUrl,
      svgContent,
      pngDataUrl,
      storagePath,
      format: 'PNG_SVG' as const,
      qrType: 'CUSTOMER_ORDER' as const,
      version: 1,
      createdBy: req.auth!.uid,
      createdAt: now,
    };

    tx.set(qrRef, qrDocPayload);
    tx.update(orderRef, {
      qrCodeId: orderId,
      printFileReady: true,
      updatedAt: now,
    });

    return {
      ...qrDocPayload,
      createdAt: new Date().toISOString(),
      alreadyExists: false,
    };
  });

  if (!txOutcome.alreadyExists) {
    await writeAuditLog({
      actorUid: req.auth.uid,
      actorEmail,
      actorRole,
      action: 'GENERATE_ORDER_QR',
      targetCollection: 'qrCodes',
      targetId: orderId,
      details: `Prepared verified print QR for order ${String(orderData.orderNumber || orderId)} (${txOutcome.targetUrl})`,
    });
  }

  return txOutcome;
});

// 23. adminSendDesignToPrint (Server-authoritative direct-to-print order + QR for verified paid orders or explicit complimentary runs)
export const adminSendDesignToPrint = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['ADMIN', 'SUPERADMIN']);
  const actorEmail = typeof req.auth.token?.email === 'string' ? req.auth.token.email : '';
  const data = (req.data || {}) as {
    designId?: unknown;
    orderId?: unknown;
    printerId?: unknown;
    initialOrderStatus?: unknown;
    cardType?: unknown;
    quantity?: unknown;
    markPaymentCompleted?: unknown;
    complimentary?: unknown;
    complimentaryReason?: unknown;
    shippingAddress?: Record<string, unknown>;
    notes?: unknown;
  };

  if (data.markPaymentCompleted !== undefined) {
    throw new HttpsError(
      'invalid-argument',
      'markPaymentCompleted is no longer supported; use adminReconcileOrderPayment to verify payments or pass complimentary=true with complimentaryReason for unpaid complimentary runs.'
    );
  }

  const designId = assertValidDocId(data.designId, 'designId');
  const existingOrderId =
    typeof data.orderId === 'string' && data.orderId.trim()
      ? assertValidDocId(data.orderId, 'orderId')
      : '';
  const printerId = assertValidDocId(data.printerId || 'admin_inhouse', 'printerId');
  const initialOrderStatus =
    typeof data.initialOrderStatus === 'string' && data.initialOrderStatus.trim()
      ? data.initialOrderStatus.trim()
      : 'Assigned to Printer';
  if (!ALL_ORDER_STATUSES.has(initialOrderStatus) || initialOrderStatus === 'Payment Successful' || initialOrderStatus === 'Refunded') {
    throw new HttpsError('invalid-argument', `Invalid initialOrderStatus "${initialOrderStatus}".`);
  }

  const quantity = Number(data.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    throw new HttpsError('invalid-argument', 'Quantity must be an integer between 1 and 500.');
  }

  const complimentary = data.complimentary === true;
  const complimentaryReason =
    typeof data.complimentaryReason === 'string' ? data.complimentaryReason.trim().slice(0, 500) : '';
  if (data.complimentary !== undefined && typeof data.complimentary !== 'boolean') {
    throw new HttpsError('invalid-argument', 'complimentary must be a boolean.');
  }

  const rawAddr = (data.shippingAddress || {}) as Record<string, unknown>;
  const shippingAddress = {
    fullName: String(rawAddr.fullName || '').trim().slice(0, 120),
    mobile: String(rawAddr.mobile || '').trim().slice(0, 30),
    email: String(rawAddr.email || '').trim().slice(0, 254),
    addressLine1: String(rawAddr.addressLine1 || '').trim().slice(0, 300),
    addressLine2: String(rawAddr.addressLine2 || '').trim().slice(0, 300),
    city: String(rawAddr.city || '').trim().slice(0, 100),
    state: String(rawAddr.state || 'Maharashtra').trim().slice(0, 100),
    pinCode: String(rawAddr.pinCode || '').trim().slice(0, 20),
    country: String(rawAddr.country || 'India').trim().slice(0, 80),
  };
  if (!shippingAddress.fullName || !shippingAddress.mobile || !shippingAddress.email || !shippingAddress.addressLine1 || !shippingAddress.city || !shippingAddress.pinCode) {
    throw new HttpsError('invalid-argument', 'Complete recipient shippingAddress is required.');
  }
  const notes = typeof data.notes === 'string' ? data.notes.trim().slice(0, 2000) : undefined;

  if (printerId !== 'admin_inhouse') {
    const printerSnap = await db.collection('printers').doc(printerId).get();
    if (!printerSnap.exists || printerSnap.data()?.status !== 'Active') {
      throw new HttpsError('failed-precondition', `Printer ${printerId} is not active.`);
    }
  }

  const designSnap = await db.collection('cardDesigns').doc(designId).get();
  if (!designSnap.exists) {
    throw new HttpsError('not-found', `Card design cardDesigns/${designId} not found.`);
  }
  const designData = (designSnap.data() || {}) as Record<string, unknown>;
  if (designData.approved !== true) {
    throw new HttpsError('failed-precondition', `Card design ${designId} must be approved before sending to print.`);
  }
  const ownerUid = String(designData.uid || '').trim();
  const profileId = String(designData.profileId || '').trim();
  const templateId = String(designData.templateId || '').trim();
  if (!ownerUid || !profileId || !templateId) {
    throw new HttpsError('failed-precondition', `Card design ${designId} is missing uid, profileId, or templateId.`);
  }

  let existingOrderData: Record<string, unknown> | null = null;
  if (existingOrderId) {
    const ordSnap = await db.collection('orders').doc(existingOrderId).get();
    if (!ordSnap.exists) {
      throw new HttpsError('not-found', `Existing order ${existingOrderId} not found.`);
    }
    existingOrderData = (ordSnap.data() || {}) as Record<string, unknown>;
    if (existingOrderData.uid !== ownerUid) {
      throw new HttpsError('failed-precondition', 'Existing order owner does not match card design owner.');
    }
  }

  const alreadyPaid =
    existingOrderData?.paymentStatus === 'Verified' ||
    existingOrderData?.paymentStatus === 'Completed';

  if (alreadyPaid && complimentary) {
    throw new HttpsError(
      'invalid-argument',
      'Order already has a verified payment and cannot be dispatched as complimentary.'
    );
  }
  if (!alreadyPaid) {
    if (!complimentary) {
      throw new HttpsError(
        'failed-precondition',
        'Order payment is not verified. Verify payment via adminReconcileOrderPayment first, or explicitly send as complimentary=true with complimentaryReason.'
      );
    }
    if (complimentaryReason.length < 3) {
      throw new HttpsError(
        'invalid-argument',
        'complimentaryReason (at least 3 characters) is required for complimentary unpaid print jobs.'
      );
    }
  }

  const [tplSnap, settingsSnap, profSnap] = await Promise.all([
    db.collection('cardTemplates').doc(templateId).get(),
    db.collection('appSettings').doc('global').get(),
    db.collection('profiles').doc(profileId).get(),
  ]);

  if (!tplSnap.exists) {
    throw new HttpsError('failed-precondition', `Missing authoritative template cardTemplates/${templateId}.`);
  }
  const tpl = (tplSnap.data() || {}) as Record<string, unknown>;
  if (!settingsSnap.exists) {
    throw new HttpsError('failed-precondition', 'Missing authoritative pricing settings appSettings/global.');
  }
  const settingsData = (settingsSnap.data() || {}) as Record<string, unknown>;
  const taxRatePercent = typeof settingsData.taxRatePercent === 'number' && Number.isFinite(settingsData.taxRatePercent) ? settingsData.taxRatePercent : 18;
  const shippingFeeInr = typeof settingsData.shippingFeeInr === 'number' && Number.isFinite(settingsData.shippingFeeInr) ? settingsData.shippingFeeInr : 0;

  let cardTechnology: 'qr_only' | 'qr_smart' = 'qr_smart';
  if (designData.cardTechnology === 'qr_only' || designData.cardTechnology === 'qr_smart') {
    cardTechnology = designData.cardTechnology;
  } else {
    const front = designData.frontDesign as { showNfcIcon?: unknown } | undefined;
    if (front?.showNfcIcon === false) cardTechnology = 'qr_only';
  }

  const isFixedPack = tpl.pricingMode === 'fixed_pack' || FIXED_PACK_TEMPLATE_IDS.has(templateId);
  let unitPriceInr = 0;
  if (isFixedPack) {
    if (typeof tpl.priceInr !== 'number' || !Number.isFinite(tpl.priceInr) || tpl.priceInr <= 0) {
      throw new HttpsError('failed-precondition', `Missing priceInr on fixed_pack template cardTemplates/${templateId}.`);
    }
    unitPriceInr = tpl.priceInr;
  } else {
    let designTier: 'minimal' | 'designer' | null = null;
    if (tpl.designTier === 'minimal' || tpl.designTier === 'designer') {
      designTier = tpl.designTier;
    } else if (MINIMAL_TEMPLATE_IDS.has(templateId)) {
      designTier = 'minimal';
    } else if (typeof tpl.category === 'string' && tpl.category.trim().length > 0) {
      const lowerCat = tpl.category.toLowerCase();
      designTier = lowerCat.includes('minimal') || lowerCat.includes('custom upload') ? 'minimal' : 'designer';
    }
    if (!designTier) {
      throw new HttpsError('failed-precondition', `Missing designTier on cardTemplates/${templateId}.`);
    }
    unitPriceInr = CARD_TIER_PRICING[designTier][cardTechnology];
  }

  const finalQuantity = alreadyPaid && typeof existingOrderData?.quantity === 'number'
    ? existingOrderData.quantity
    : quantity;
  const subtotal = alreadyPaid && typeof existingOrderData?.subtotal === 'number'
    ? existingOrderData.subtotal
    : Math.round(unitPriceInr * finalQuantity * 100) / 100;
  const tax = alreadyPaid && typeof existingOrderData?.tax === 'number'
    ? existingOrderData.tax
    : Math.round((subtotal * taxRatePercent) / 100);
  const shipping = alreadyPaid && typeof existingOrderData?.shipping === 'number'
    ? existingOrderData.shipping
    : (subtotal > 0 ? Math.round(shippingFeeInr * 100) / 100 : 0);
  const total = alreadyPaid && typeof existingOrderData?.total === 'number'
    ? existingOrderData.total
    : Math.round((subtotal + tax + shipping) * 100) / 100;

  const isPaid = alreadyPaid;
  const effectivePaymentStatus = isPaid
    ? String(existingOrderData!.paymentStatus)
    : 'Pending';
  const effectiveNotes = !isPaid
    ? `[COMPLIMENTARY: ${complimentaryReason}]${notes ? ` ${notes}` : ''}`.slice(0, 2000)
    : notes;

  const resolvedOrderId = existingOrderId || `ord_${Date.now()}`;
  const resolvedOrderNumber =
    (typeof existingOrderData?.orderNumber === 'string' && existingOrderData.orderNumber) ||
    `TNX-${new Date().getFullYear()}-${String(Math.floor(100000 + Math.random() * 900000))}`;
  const resolvedCardType =
    (typeof data.cardType === 'string' && data.cardType.trim().slice(0, 80)) ||
    (typeof tpl.cardType === 'string' && tpl.cardType) ||
    (cardTechnology === 'qr_only' ? 'QR Only Card' : 'Matte PVC SMART');

  const slug = sanitizeSlug(
    (profSnap.exists ? profSnap.data()?.slug : '') || existingOrderData?.profileSlug || ''
  );
  if (!slug || slug.length < 3) {
    throw new HttpsError('failed-precondition', `Linked profile ${profileId} does not have a valid public slug.`);
  }

  const baseUrl = (process.env.APP_URL || 'https://tapnex.in').replace(/\/+$/, '');
  const targetUrl = `${baseUrl}/p/${slug}`;
  const qrRef = db.collection('qrCodes').doc(resolvedOrderId);
  const existingQrSnap = await qrRef.get();
  const needsFreshQr =
    !existingQrSnap.exists ||
    !existingQrSnap.data()?.pngDataUrl ||
    !existingQrSnap.data()?.svgContent ||
    String(existingQrSnap.data()?.targetUrl || '').endsWith('/p/undefined');

  const storagePath = `qrCodes/${resolvedOrderId}/qr.png`;
  const generatedArt = needsFreshQr ? await generateServerQrArtwork({ targetUrl, storagePath }) : null;
  const resolvedQrType = isPaid ? 'CUSTOMER_ORDER' : 'ADMIN_CUSTOM';

  const orderRef = db.collection('orders').doc(resolvedOrderId);
  const designRef = db.collection('cardDesigns').doc(designId);
  const profileRef = db.collection('profiles').doc(profileId);
  const pubProfileRef = db.collection('publicProfiles').doc(slug);

  const txResult = await db.runTransaction(async (tx) => {
    const [curOrderSnap, curQrSnap, curProfSnap, curPubSnap] = await Promise.all([
      tx.get(orderRef),
      tx.get(qrRef),
      tx.get(profileRef),
      tx.get(pubProfileRef),
    ]);

    const now = FieldValue.serverTimestamp();
    let finalQrRecord: Record<string, unknown>;

    if (curQrSnap.exists && !needsFreshQr) {
      const existingQrData = (curQrSnap.data() || {}) as Record<string, unknown>;
      tx.update(qrRef, {
        printerId,
        qrType: resolvedQrType,
      });
      finalQrRecord = {
        ...existingQrData,
        printerId,
        qrType: resolvedQrType,
      };
    } else {
      finalQrRecord = {
        qrCodeId: resolvedOrderId,
        uid: ownerUid,
        orderId: resolvedOrderId,
        printerId,
        targetUrl,
        svgContent: generatedArt!.svgContent,
        pngDataUrl: generatedArt!.pngDataUrl,
        storagePath,
        format: 'PNG_SVG',
        qrType: resolvedQrType,
        version: 1,
        createdBy: req.auth!.uid,
        createdAt: now,
      };
      tx.set(qrRef, finalQrRecord);
    }

    if (curOrderSnap.exists) {
      const curOrderData = (curOrderSnap.data() || {}) as Record<string, unknown>;
      const curPaid =
        curOrderData.paymentStatus === 'Verified' ||
        curOrderData.paymentStatus === 'Completed';
      if (isPaid && !curPaid) {
        throw new HttpsError('failed-precondition', 'Order payment status changed before transaction completed.');
      }
      if (!isPaid && curPaid) {
        throw new HttpsError('failed-precondition', 'Order was paid before complimentary dispatch completed.');
      }
      tx.update(orderRef, {
        printerId,
        quantity: finalQuantity,
        cardType: resolvedCardType,
        subtotal,
        tax,
        shipping,
        total,
        paymentStatus: effectivePaymentStatus,
        orderStatus: initialOrderStatus,
        shippingAddress,
        qrCodeId: resolvedOrderId,
        printFileReady: true,
        ...(!isPaid ? { complimentary: true, complimentaryReason } : {}),
        ...(effectiveNotes !== undefined ? { internalNotes: effectiveNotes } : {}),
        updatedAt: now,
      });
    } else {
      tx.set(orderRef, {
        orderId: resolvedOrderId,
        orderNumber: resolvedOrderNumber,
        uid: ownerUid,
        profileId,
        profileSlug: slug,
        designId,
        orderSource: 'studio',
        printerId,
        quantity: finalQuantity,
        cardType: resolvedCardType,
        subtotal,
        tax,
        shipping,
        total,
        currency: 'INR',
        paymentStatus: effectivePaymentStatus,
        orderStatus: initialOrderStatus,
        shippingAddress,
        qrCodeId: resolvedOrderId,
        printFileReady: true,
        ...(!isPaid ? { complimentary: true, complimentaryReason } : {}),
        ...(effectiveNotes ? { internalNotes: effectiveNotes } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }

    tx.update(designRef, {
      approved: true,
      locked: true,
      orderId: resolvedOrderId,
      updatedAt: now,
    });

    if (isPaid) {
      if (curProfSnap.exists && !curProfSnap.data()?.adminDisabled) {
        tx.update(profileRef, {
          paymentConfirmed: true,
          isPublic: true,
          updatedAt: now,
        });
      }
      if (curPubSnap.exists && !curPubSnap.data()?.adminDisabled) {
        tx.update(pubProfileRef, {
          paymentConfirmed: true,
          isPublic: true,
          lastPaidOrderId: resolvedOrderId,
          updatedAt: now,
        });
      }
    }

    return {
      orderId: resolvedOrderId,
      orderNumber: resolvedOrderNumber,
      complimentary: !isPaid,
      paymentStatus: effectivePaymentStatus,
      qrRecord: {
        ...finalQrRecord,
        createdAt: new Date().toISOString(),
      },
    };
  });

  await writeAuditLog({
    actorUid: req.auth.uid,
    actorEmail,
    actorRole,
    action: isPaid ? 'SEND_DESIGN_TO_PRINT' : 'SEND_COMPLIMENTARY_PRINT',
    targetCollection: 'orders',
    targetId: resolvedOrderId,
    details: isPaid
      ? `Sent paid design ${designId} (${resolvedOrderNumber}) to print [${printerId}] status=${initialOrderStatus}, payment=${effectivePaymentStatus}, total=${total}`
      : `Sent complimentary unpaid design ${designId} (${resolvedOrderNumber}) to print [${printerId}] status=${initialOrderStatus}, payment=Pending, reason="${complimentaryReason}"`,
  });

  return txResult;
});

// 14. sendTransactionalEmail
export const sendTransactionalEmail = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const { to, subject, html } = req.data as { to: string; subject: string; html: string };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { delivered: false, reason: 'RESEND_API_KEY not configured' };
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || 'orders@tapnex.in', to: [to], subject, html }),
  });
  return { delivered: resp.ok };
});

// 15. createShippingRecord
export const createShippingRecord = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  await assertRole(req.auth, ['PRINTER', 'ADMIN', 'SUPERADMIN']);
  const { orderId, courierName, trackingNumber, trackingUrl, dispatchDate } = req.data as {
    orderId: string;
    courierName: string;
    trackingNumber: string;
    trackingUrl?: string;
    dispatchDate: string;
  };
  const orderSnap = await db.collection('orders').doc(orderId).get();
  const ref = db.collection('shippingRecords').doc();
  await ref.set({
    shippingId: ref.id,
    orderId,
    uid: orderSnap.data()?.uid,
    printerId: req.auth.uid,
    courierName,
    trackingNumber,
    trackingUrl: trackingUrl || '',
    dispatchDate,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection('orders').doc(orderId).update({
    orderStatus: 'Dispatched',
    courierName,
    trackingNumber,
    trackingUrl: trackingUrl || '',
    dispatchDate,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { shippingId: ref.id };
});

// 16. exportAdminReport
export const exportAdminReport = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  await assertRole(req.auth, ['ADMIN', 'SUPERADMIN']);
  const ordersSnap = await db.collection('orders').get();
  return { totalOrders: ordersSnap.size, generatedAt: new Date().toISOString() };
});

// 17. deleteUserSafely
export const deleteUserSafely = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['ADMIN', 'SUPERADMIN']);
  const { targetUid } = req.data as { targetUid: string };
  if (targetUid === req.auth.uid) throw new HttpsError('failed-precondition', 'Cannot delete own active account.');
  await db.collection('users').doc(targetUid).update({ status: 'Disabled', updatedAt: FieldValue.serverTimestamp() });
  await writeAuditLog({
    actorUid: req.auth.uid,
    actorRole,
    action: 'SAFE_DELETE_USER',
    targetCollection: 'users',
    targetId: targetUid,
    details: 'Account disabled and anonymized while retaining order ledger integrity.',
  });
  return { targetUid, disabled: true };
});

// 18. recordAuditLog
export const recordAuditLog = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth, ['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']);
  await writeAuditLog({
    actorUid: req.auth.uid,
    actorEmail: req.auth.token.email,
    actorRole,
    action: String(req.data?.action || 'ACTION'),
    targetCollection: String(req.data?.targetCollection || 'system'),
    targetId: String(req.data?.targetId || 'unknown'),
    details: String(req.data?.details || ''),
  });
  return { logged: true };
});

// 19. validatePrinterAccess
export const validatePrinterAccess = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  await assertRole(req.auth, ['PRINTER', 'ADMIN', 'SUPERADMIN']);
  const { orderId } = req.data as { orderId: string };
  const orderSnap = await db.collection('orders').doc(orderId).get();
  const allowed = orderSnap.exists && orderSnap.data()?.printerId === req.auth.uid;
  return { allowed };
});
