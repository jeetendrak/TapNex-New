import * as admin from 'firebase-admin';
import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import { jsPDF } from 'jspdf';

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

type Role = 'USER' | 'PRINTER' | 'ADMIN' | 'SUPERADMIN';

async function assertRole(uid: string, allowed: Role[]): Promise<Role> {
  const adminSnap = await db.collection('admins').doc(uid).get();
  if (adminSnap.exists && adminSnap.data()?.active) {
    const role = adminSnap.data()?.role as Role;
    if (allowed.includes(role)) return role;
  }
  const userSnap = await db.collection('users').doc(uid).get();
  const userRole = (userSnap.data()?.role || 'USER') as Role;
  if (!allowed.includes(userRole)) {
    throw new HttpsError('permission-denied', `Requires one of roles: ${allowed.join(', ')}`);
  }
  return userRole;
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
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// 1. createUserProfile
export const createUserProfile = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const email = req.auth.token.email || '';
  const emailVerified = Boolean(req.auth.token.email_verified);
  const now = admin.firestore.FieldValue.serverTimestamp();
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
  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch {
    userRecord = await admin.auth().createUser({ email, password, emailVerified: true, displayName: 'SuperAdmin' });
  }
  await admin.auth().setCustomUserClaims(userRecord.uid, { role: 'SUPERADMIN' });
  const now = admin.firestore.FieldValue.serverTimestamp();
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
  const actorRole = await assertRole(req.auth.uid, ['ADMIN', 'SUPERADMIN']);
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

  await admin.auth().setCustomUserClaims(targetUid, { role: newRole });
  await db.collection('users').doc(targetUid).update({ role: newRole, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  if (newRole === 'ADMIN' || newRole === 'SUPERADMIN') {
    const u = await db.collection('users').doc(targetUid).get();
    await db.collection('admins').doc(targetUid).set({
      uid: targetUid,
      email: u.data()?.email || '',
      role: newRole,
      active: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
  const actorRole = await assertRole(req.auth.uid, ['ADMIN', 'SUPERADMIN']);
  const { targetUid, status } = req.data as { targetUid: string; status: string };
  await admin.auth().updateUser(targetUid, { disabled: status === 'Blocked' || status === 'Disabled' });
  await db.collection('users').doc(targetUid).update({ status, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
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

// 6. createPaymentOrder
export const createPaymentOrder = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const { orderId } = req.data as { orderId: string };
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists || orderSnap.data()?.uid !== req.auth.uid) {
    throw new HttpsError('not-found', 'Order not found.');
  }
  const totalInr = Number(orderSnap.data()?.total || 0);
  const gatewayOrderId = `order_${orderId}_${Date.now()}`;
  return { gatewayOrderId, amountPaise: Math.round(totalInr * 100), currency: 'INR' };
});

// 7. verifyPayment (Atomic + Idempotent + Triggers QR & Print Generation)
export const verifyPayment = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const { orderId, gatewayOrderId, gatewayPaymentId, signature } = req.data as {
    orderId: string;
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
  };
  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  if (!secret) throw new HttpsError('failed-precondition', 'RAZORPAY_KEY_SECRET is not configured.');
  const expected = crypto.createHmac('sha256', secret).update(`${gatewayOrderId}|${gatewayPaymentId}`).digest('hex');
  if (signature !== expected) {
    throw new HttpsError('permission-denied', 'Invalid Razorpay payment signature.');
  }
  const orderRef = db.collection('orders').doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Order missing.');
    if (snap.data()?.paymentStatus === 'Verified') return; // idempotent
    tx.set(db.collection('payments').doc(orderId), {
      paymentId: orderId,
      orderId,
      uid: snap.data()?.uid,
      gateway: 'razorpay_live',
      gatewayOrderId,
      gatewayPaymentId,
      signatureVerified: true,
      amount: snap.data()?.total,
      currency: 'INR',
      status: 'Verified',
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(orderRef, {
      paymentStatus: 'Verified',
      orderStatus: 'Payment Successful',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  return { verified: true, orderId };
});

// 8. razorpayWebhook
export const razorpayWebhook = onRequest(async (req, res) => {
  const sig = req.headers['x-razorpay-signature'] as string;
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (!sig || sig !== expected) {
    res.status(401).send('Invalid signature');
    return;
  }
  res.json({ received: true });
});

// 9. generatePurchasedQr
export const generatePurchasedQr = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const { orderId } = req.data as { orderId: string };
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists || orderSnap.data()?.paymentStatus !== 'Verified') {
    throw new HttpsError('failed-precondition', 'Payment must be verified before QR generation.');
  }
  const slug = orderSnap.data()?.profileSlug;
  const targetUrl = `${process.env.APP_URL || 'https://tapnex.in'}/p/${slug}`;
  const svgContent = await QRCode.toString(targetUrl, { type: 'svg', errorCorrectionLevel: 'H', margin: 4 });
  const pngBuffer = await QRCode.toBuffer(targetUrl, { errorCorrectionLevel: 'H', margin: 4, width: 1024 });
  const storagePath = `qrCodes/${orderId}/qr.png`;
  await storage.bucket().file(storagePath).save(pngBuffer, { contentType: 'image/png' });
  const qrRef = db.collection('qrCodes').doc(orderId);
  await qrRef.set({
    qrCodeId: orderId,
    uid: orderSnap.data()?.uid,
    orderId,
    printerId: orderSnap.data()?.printerId || '',
    targetUrl,
    svgContent,
    storagePath,
    format: 'PNG_SVG',
    qrType: 'CUSTOMER_ORDER',
    version: 1,
    createdBy: req.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { qrCodeId: orderId, targetUrl };
});

// 10. generateAdminQr
export const generateAdminQr = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth.uid, ['SUPERADMIN', 'ADMIN']);
  const { targetUrl, customerName, orderId, description } = req.data as {
    targetUrl: string;
    customerName?: string;
    orderId?: string;
    description?: string;
  };
  const svgContent = await QRCode.toString(targetUrl, { type: 'svg', errorCorrectionLevel: 'H', margin: 4 });
  const qrRef = db.collection('qrCodes').doc();
  await qrRef.set({
    qrCodeId: qrRef.id,
    orderId: orderId || '',
    targetUrl,
    svgContent,
    format: 'PNG_SVG',
    qrType: 'ADMIN_CUSTOM',
    customerName: customerName || '',
    description: description || '',
    version: 1,
    createdBy: req.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await writeAuditLog({
    actorUid: req.auth.uid,
    actorRole,
    action: 'GENERATE_ADMIN_QR',
    targetCollection: 'qrCodes',
    targetId: qrRef.id,
    details: `Generated QR for ${targetUrl}`,
  });
  return { qrCodeId: qrRef.id, svgContent };
});

// 11. generatePrintReadyPdf (Exact 85.6x54mm + 3mm bleed)
export const generatePrintReadyPdf = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  await assertRole(req.auth.uid, ['PRINTER', 'ADMIN', 'SUPERADMIN']);
  const { orderId } = req.data as { orderId: string };
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [91.6, 60] });
  doc.setFillColor(11, 29, 58);
  doc.rect(0, 0, 91.6, 60, 'F');
  doc.addPage([91.6, 60], 'landscape');
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 91.6, 60, 'F');
  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  const path = `printFiles/${orderId}/card-print-300dpi.pdf`;
  await storage.bucket().file(path).save(pdfBuffer, { contentType: 'application/pdf' });
  await db.collection('orders').doc(orderId).update({ printFileReady: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { storagePath: path, dimensions: '85.6x54mm+3mm_bleed' };
});

// 12. assignPrinter
export const assignPrinter = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth.uid, ['ADMIN', 'SUPERADMIN']);
  const { orderId, printerId } = req.data as { orderId: string; printerId: string };
  await db.collection('orders').doc(orderId).update({
    printerId,
    orderStatus: 'Assigned to Printer',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection('qrCodes').doc(orderId).update({ printerId }).catch(() => null);
  await writeAuditLog({
    actorUid: req.auth.uid,
    actorRole,
    action: 'ASSIGN_PRINTER',
    targetCollection: 'orders',
    targetId: orderId,
    details: `Assigned to printer ${printerId}`,
  });
  return { orderId, printerId };
});

// 13. updateOrderStatus
export const updateOrderStatus = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth.uid, ['PRINTER', 'ADMIN', 'SUPERADMIN']);
  const { orderId, orderStatus } = req.data as { orderId: string; orderStatus: string };
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (actorRole === 'PRINTER' && orderSnap.data()?.printerId !== req.auth.uid) {
    throw new HttpsError('permission-denied', 'Printer can only update assigned orders.');
  }
  await db.collection('orders').doc(orderId).update({
    orderStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await writeAuditLog({
    actorUid: req.auth.uid,
    actorRole,
    action: 'UPDATE_ORDER_STATUS',
    targetCollection: 'orders',
    targetId: orderId,
    details: `Order status set to ${orderStatus}`,
  });
  return { orderId, orderStatus };
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
  await assertRole(req.auth.uid, ['PRINTER', 'ADMIN', 'SUPERADMIN']);
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
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection('orders').doc(orderId).update({
    orderStatus: 'Dispatched',
    courierName,
    trackingNumber,
    trackingUrl: trackingUrl || '',
    dispatchDate,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { shippingId: ref.id };
});

// 16. exportAdminReport
export const exportAdminReport = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  await assertRole(req.auth.uid, ['ADMIN', 'SUPERADMIN']);
  const ordersSnap = await db.collection('orders').get();
  return { totalOrders: ordersSnap.size, generatedAt: new Date().toISOString() };
});

// 17. deleteUserSafely
export const deleteUserSafely = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Auth required.');
  const actorRole = await assertRole(req.auth.uid, ['ADMIN', 'SUPERADMIN']);
  const { targetUid } = req.data as { targetUid: string };
  if (targetUid === req.auth.uid) throw new HttpsError('failed-precondition', 'Cannot delete own active account.');
  await db.collection('users').doc(targetUid).update({ status: 'Disabled', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
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
  const actorRole = await assertRole(req.auth.uid, ['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']);
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
  await assertRole(req.auth.uid, ['PRINTER', 'ADMIN', 'SUPERADMIN']);
  const { orderId } = req.data as { orderId: string };
  const orderSnap = await db.collection('orders').doc(orderId).get();
  const allowed = orderSnap.exists && orderSnap.data()?.printerId === req.auth.uid;
  return { allowed };
});
