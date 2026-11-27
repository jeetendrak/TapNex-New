import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

/**
 * Runs only against the local Firestore Emulator, never a live Firebase project.
 * The separate firebase.emulator.test.json maps the same firestore.rules file
 * to the emulator's isolated default database for RulesTestContext compatibility.
 */
const PROJECT_ID = 'demo-tapnex-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;

const IDS = {
  customer: 'customer1',
  otherCustomer: 'customer2',
  admin: 'admin1',
  printer: 'printer1',
  profile: 'profile1',
  otherProfile: 'profile2',
  slug: 'owner-profile',
  order: 'order1',
  printerOrder: 'printerorder1',
  payment: 'payment1',
  qr: 'qrorder1',
} as const;

let testEnv: RulesTestEnvironment;

const customerContext = () =>
  testEnv.authenticatedContext(IDS.customer, {
    email: 'customer@example.test',
    email_verified: true,
  });

const otherCustomerContext = () =>
  testEnv.authenticatedContext(IDS.otherCustomer, {
    email: 'other@example.test',
    email_verified: true,
  });

const adminContext = () =>
  testEnv.authenticatedContext(IDS.admin, {
    email: 'admin@example.test',
    email_verified: true,
  });

const printerContext = () =>
  testEnv.authenticatedContext(IDS.printer, {
    email: 'printer@example.test',
    email_verified: true,
  });

function orderRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    orderId: IDS.order,
    orderNumber: 'TN-TEST-0001',
    uid: IDS.customer,
    profileId: IDS.profile,
    designId: 'design1',
    orderSource: 'shop',
    quantity: 1,
    subtotal: 999,
    tax: 179.82,
    shipping: 99,
    total: 1277.82,
    currency: 'INR',
    paymentStatus: 'Pending',
    orderStatus: 'Awaiting Payment',
    shippingAddress: {},
    qrCodeId: '',
    printFileReady: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function seedData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = new Date('2026-01-01T00:00:00.000Z');

    await Promise.all([
      db.doc(`users/${IDS.customer}`).set({ uid: IDS.customer, role: 'USER', status: 'Active' }),
      db.doc(`users/${IDS.otherCustomer}`).set({ uid: IDS.otherCustomer, role: 'USER', status: 'Active' }),
      db.doc(`users/${IDS.admin}`).set({ uid: IDS.admin, role: 'ADMIN', status: 'Active' }),
      db.doc(`admins/${IDS.admin}`).set({
        uid: IDS.admin,
        email: 'admin@example.test',
        role: 'ADMIN',
        active: true,
        updatedAt: now,
      }),
      db.doc(`printers/${IDS.printer}`).set({
        printerId: IDS.printer,
        uid: IDS.printer,
        status: 'Active',
      }),
      db.doc(`profiles/${IDS.profile}`).set({
        profileId: IDS.profile,
        uid: IDS.customer,
        slug: IDS.slug,
        personalInformation: { fullName: 'Test Customer' },
        visibilitySettings: {},
        isPublic: false,
        paymentConfirmed: false,
        createdAt: now,
        updatedAt: now,
      }),
      db.doc(`profiles/${IDS.otherProfile}`).set({
        profileId: IDS.otherProfile,
        uid: IDS.otherCustomer,
        slug: 'other-profile',
        personalInformation: { fullName: 'Other Customer' },
        visibilitySettings: {},
        isPublic: false,
        paymentConfirmed: false,
        createdAt: now,
        updatedAt: now,
      }),
      db.doc(`publicProfiles/${IDS.slug}`).set({
        slug: IDS.slug,
        profileId: IDS.profile,
        uid: IDS.customer,
        isPublic: true,
        paymentConfirmed: false,
        updatedAt: now,
      }),
      db.doc(`orders/${IDS.order}`).set(orderRecord()),
      db.doc(`orders/${IDS.printerOrder}`).set(
        orderRecord({
          orderId: IDS.printerOrder,
          orderNumber: 'TN-TEST-0002',
          printerId: IDS.printer,
        }),
      ),
      db.doc(`payments/${IDS.payment}`).set({
        paymentId: IDS.payment,
        orderId: IDS.order,
        uid: IDS.customer,
        gateway: 'razorpay_live',
        gatewayOrderId: 'order_test_123',
        signatureVerified: true,
        amount: 1277.82,
        currency: 'INR',
        status: 'Verified',
        createdAt: now,
      }),
      db.doc(`qrCodes/${IDS.qr}`).set({
        qrCodeId: IDS.qr,
        uid: IDS.customer,
        orderId: IDS.order,
        printerId: IDS.printer,
        targetUrl: 'https://example.test/profile/owner-profile',
        svgContent: '<svg></svg>',
        format: 'PNG_SVG',
        qrType: 'CUSTOMER_ORDER',
        version: 1,
        createdBy: 'test-admin',
        createdAt: now,
      }),
      db.doc('appSettings/global').set({
        settingId: 'global',
        allowCustomerQrView: false,
      }),
    ]);
  });
}

describe('TapNex Firestore Security Rules — local Emulator', () => {
  beforeAll(async () => {
    const rulesPath = resolve(process.cwd(), 'firestore.rules');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: FIRESTORE_HOST,
        port: FIRESTORE_PORT,
        rules: readFileSync(rulesPath, 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedData();
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  it('denies unauthenticated reads of private user and profile documents', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.doc(`users/${IDS.customer}`).get());
    await assertFails(db.doc(`profiles/${IDS.profile}`).get());
  });

  it('allows public profile reads without authentication', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(db.doc(`publicProfiles/${IDS.slug}`).get());
  });

  it('allows customers to read their own profile but not another customer profile', async () => {
    const db = customerContext().firestore();
    await assertSucceeds(db.doc(`profiles/${IDS.profile}`).get());
    await assertFails(db.doc(`profiles/${IDS.otherProfile}`).get());
  });

  it('allows a customer to create a Pending shop order', async () => {
    const db = customerContext().firestore();
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const newOrder = {
      ...orderRecord({ orderId: 'ordernew', orderNumber: 'TN-TEST-NEW' }),
      createdAt: now,
      updatedAt: now,
    };
    await assertSucceeds(db.doc('orders/ordernew').set(newOrder));
  });

  it('rejects a customer-created order marked Verified or Payment Successful', async () => {
    const db = customerContext().firestore();
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const forgedOrder = {
      ...orderRecord({ orderId: 'orderforged', orderNumber: 'TN-TEST-FORGE' }),
      paymentStatus: 'Verified',
      orderStatus: 'Payment Successful',
      createdAt: now,
      updatedAt: now,
    };
    await assertFails(db.doc('orders/orderforged').set(forgedOrder));
  });

  it('rejects customer changes to order paymentStatus, total, or QR linkage', async () => {
    const db = customerContext().firestore();
    await assertFails(
      db.doc(`orders/${IDS.order}`).update({
        paymentStatus: 'Verified',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
    await assertFails(
      db.doc(`orders/${IDS.order}`).update({
        total: 1,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
    await assertFails(
      db.doc(`orders/${IDS.order}`).update({
        qrCodeId: 'forgedqr',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
  });

  it('rejects administrator browser changes to payment status and Payment Successful order status', async () => {
    const db = adminContext().firestore();
    await assertFails(
      db.doc(`orders/${IDS.order}`).update({
        paymentStatus: 'Verified',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
    await assertFails(
      db.doc(`orders/${IDS.order}`).update({
        orderStatus: 'Payment Successful',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
  });

  it('allows an assigned active printer to update an ordinary fulfilment status', async () => {
    const db = printerContext().firestore();
    await assertSucceeds(
      db.doc(`orders/${IDS.printerOrder}`).update({
        orderStatus: 'Printing in Progress',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
  });

  it('rejects printer attempts to mark an assigned order paid', async () => {
    const db = printerContext().firestore();
    await assertFails(
      db.doc(`orders/${IDS.printerOrder}`).update({
        orderStatus: 'Payment Successful',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
    await assertFails(
      db.doc(`orders/${IDS.printerOrder}`).update({
        paymentStatus: 'Verified',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
  });

  it('rejects customers and administrators from changing profile payment flags', async () => {
    const customerDb = customerContext().firestore();
    const adminDb = adminContext().firestore();

    await assertFails(
      customerDb.doc(`profiles/${IDS.profile}`).update({
        paymentConfirmed: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
    await assertFails(
      adminDb.doc(`profiles/${IDS.profile}`).update({
        paymentConfirmed: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
    await assertFails(
      adminDb.doc(`profiles/${IDS.profile}`).update({
        paymentReference: 'manual-reference',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
  });

  it('rejects customer, administrator, and printer writes to public profile payment flags', async () => {
    const customerDb = customerContext().firestore();
    const adminDb = adminContext().firestore();
    const printerDb = printerContext().firestore();

    await assertFails(
      customerDb.doc(`publicProfiles/${IDS.slug}`).update({
        paymentConfirmed: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
    await assertFails(
      adminDb.doc(`publicProfiles/${IDS.slug}`).update({
        lastPaidOrderId: IDS.order,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
    await assertFails(
      printerDb.doc(`publicProfiles/${IDS.slug}`).update({
        paymentConfirmed: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
  });

  it('rejects customer, administrator, and printer creation of payment documents', async () => {
    const contexts = [
      { db: customerContext().firestore(), actor: IDS.customer },
      { db: adminContext().firestore(), actor: IDS.admin },
      { db: printerContext().firestore(), actor: IDS.printer },
    ];

    for (const { db } of contexts) {
      await assertFails(
        db.doc('payments/forgedpayment').set({
          paymentId: 'forgedpayment',
          orderId: IDS.order,
          uid: IDS.customer,
          gateway: 'razorpay_live',
          gatewayOrderId: 'fake_order',
          signatureVerified: true,
          amount: 1,
          currency: 'INR',
          status: 'Verified',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }),
      );
    }
  });

  it('rejects browser updates and deletes of existing payment documents', async () => {
    const db = adminContext().firestore();
    await assertFails(db.doc(`payments/${IDS.payment}`).update({ status: 'Refunded' }));
    await assertFails(db.doc(`payments/${IDS.payment}`).delete());
  });

  it('rejects customer, administrator, and printer creation of purchased QR documents', async () => {
    const contexts = [
      { db: customerContext().firestore(), actor: IDS.customer },
      { db: adminContext().firestore(), actor: IDS.admin },
      { db: printerContext().firestore(), actor: IDS.printer },
    ];

    for (const { db, actor } of contexts) {
      await assertFails(
        db.doc('qrCodes/forgedqr').set({
          qrCodeId: 'forgedqr',
          uid: IDS.customer,
          orderId: IDS.order,
          targetUrl: 'https://example.test/forged',
          svgContent: '<svg></svg>',
          format: 'PNG_SVG',
          qrType: 'CUSTOMER_ORDER',
          version: 1,
          createdBy: actor,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }),
      );
    }
  });

  it('rejects browser updates and deletes of existing QR documents', async () => {
    const db = adminContext().firestore();
    await assertFails(db.doc(`qrCodes/${IDS.qr}`).update({ targetUrl: 'https://example.test/replaced' }));
    await assertFails(db.doc(`qrCodes/${IDS.qr}`).delete());
  });

  it('rejects an unverified administrator browser session', async () => {
    const unverifiedAdmin = testEnv.authenticatedContext(IDS.admin, {
      email: 'admin@example.test',
      email_verified: false,
    });
    const db = unverifiedAdmin.firestore();
    await assertFails(db.doc(`orders/${IDS.order}`).get());
    await assertFails(
      db.doc(`orders/${IDS.order}`).update({
        orderStatus: 'Processing',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }),
    );
  });
});
