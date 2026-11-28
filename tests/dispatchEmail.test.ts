import fs from 'fs';
import path from 'path';
import * as esbuild from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISPATCH_SAVE_FAILED,
  DISPATCH_SUCCESS_EMAIL_FAILED,
  DISPATCH_SUCCESS_EMAIL_SENT,
  executeDispatchWithNotification,
  executeRetryDispatchEmail,
  formatEmailDeliveryFailureReason,
} from '../src/lib/dispatchEmailFeedback';
import { DEFAULT_EMAIL_TEMPLATES } from '../src/lib/constants';
import { FulfilmentTimeline } from '../src/components/FulfilmentTimeline';
import type { OrderRecord } from '../src/types';

type DocData = Record<string, unknown>;

interface MockDocSnap {
  id: string;
  exists: boolean;
  ref: MockDocRef;
  data: () => DocData | undefined;
}

interface MockDocRef {
  id: string;
  collectionName: string;
  path: string;
  get: () => Promise<MockDocSnap>;
  set: (data: DocData, options?: { merge?: boolean }) => Promise<void>;
  update: (data: DocData) => Promise<void>;
  delete: () => Promise<void>;
}

function createInMemoryFirestore() {
  const store = new Map<string, Map<string, DocData>>();
  let autoIdCounter = 0;

  const getColMap = (name: string): Map<string, DocData> => {
    let map = store.get(name);
    if (!map) {
      map = new Map<string, DocData>();
      store.set(name, map);
    }
    return map;
  };

  const resolveValues = (obj: DocData): DocData => {
    const out: DocData = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && (v as { __serverTimestamp?: boolean }).__serverTimestamp) {
        out[k] = '2026-11-28T04:00:00.000Z';
      } else {
        out[k] = structuredClone(v);
      }
    }
    return out;
  };

  const makeDocRef = (collectionName: string, docId: string): MockDocRef => {
    const docPath = `${collectionName}/${docId}`;
    const ref: MockDocRef = {
      id: docId,
      collectionName,
      path: docPath,
      async get() {
        const existing = getColMap(collectionName).get(docId);
        return {
          id: docId,
          exists: existing !== undefined,
          ref,
          data: () => (existing ? structuredClone(existing) : undefined),
        };
      },
      async set(data: DocData, options?: { merge?: boolean }) {
        const col = getColMap(collectionName);
        const resolved = resolveValues(data);
        if (options?.merge && col.has(docId)) {
          col.set(docId, { ...col.get(docId)!, ...resolved });
        } else {
          col.set(docId, resolved);
        }
      },
      async update(data: DocData) {
        const col = getColMap(collectionName);
        if (!col.has(docId)) {
          throw new Error(`Document ${docPath} does not exist.`);
        }
        col.set(docId, { ...col.get(docId)!, ...resolveValues(data) });
      },
      async delete() {
        getColMap(collectionName).delete(docId);
      },
    };
    return ref;
  };

  class MockFirestore {
    databaseId: string;
    projectId: string;
    constructor(opts: { projectId: string; databaseId: string }) {
      this.projectId = opts.projectId;
      this.databaseId = opts.databaseId;
    }
    collection(name: string) {
      return {
        doc: (id?: string) => {
          const finalId = id || `auto_${++autoIdCounter}`;
          return makeDocRef(name, finalId);
        },
        get: async () => {
          const docs = Array.from(getColMap(name).entries()).map(([id, data]) => ({
            id,
            exists: true,
            ref: makeDocRef(name, id),
            data: () => structuredClone(data),
          }));
          return { docs, empty: docs.length === 0, size: docs.length };
        },
        where: (field: string, op: string, value: unknown) => {
          const filters = [{ field, op, value }];
          let maxLimit = Number.POSITIVE_INFINITY;
          const queryObj = {
            where: (f2: string, o2: string, v2: unknown) => {
              filters.push({ field: f2, op: o2, value: v2 });
              return queryObj;
            },
            limit: (n: number) => {
              maxLimit = n;
              return queryObj;
            },
            get: async () => {
              const matched: MockDocSnap[] = [];
              for (const [id, data] of getColMap(name).entries()) {
                if (filters.every((f) => f.op === '==' && data[f.field] === f.value)) {
                  matched.push({
                    id,
                    exists: true,
                    ref: makeDocRef(name, id),
                    data: () => structuredClone(data),
                  });
                }
                if (matched.length >= maxLimit) break;
              }
              return { docs: matched, empty: matched.length === 0, size: matched.length };
            },
          };
          return queryObj;
        },
      };
    }
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const pending: Array<() => Promise<void>> = [];
      const tx = {
        get: (ref: MockDocRef) => ref.get(),
        set: (ref: MockDocRef, data: DocData, options?: { merge?: boolean }) =>
          pending.push(() => ref.set(data, options)),
        update: (ref: MockDocRef, data: DocData) => pending.push(() => ref.update(data)),
        delete: (ref: MockDocRef) => pending.push(() => ref.delete()),
      };
      const res = await fn(tx);
      for (const op of pending) await op();
      return res;
    }
  }

  return {
    MockFirestore,
    seedDoc: (col: string, id: string, data: DocData) => {
      getColMap(col).set(id, structuredClone(data));
    },
    readDoc: (col: string, id: string) => {
      const val = getColMap(col).get(id);
      return val ? structuredClone(val) : undefined;
    },
    listCol: (col: string): Array<DocData & { id: string }> =>
      Array.from(getColMap(col).entries()).map(([id, data]) => ({
        id,
        ...structuredClone(data),
      })),
  };
}

class MockHttpsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'HttpsError';
  }
}

interface WrappedCallable {
  (req: { auth?: { uid: string; token?: Record<string, unknown> } | null; data?: unknown }): Promise<
    Record<string, unknown>
  >;
  __cfOptions?: { secrets?: Array<{ name: string }> };
}

const FUNCTIONS_SOURCE_PATH = path.resolve(__dirname, '../functions/src/index.ts');
let cachedCjsCode: string | null = null;

function loadFunctionsForEmailTests(mockDb: ReturnType<typeof createInMemoryFirestore>): {
  sendTransactionalEmail: WrappedCallable;
  createShippingRecord: WrappedCallable;
} {
  if (!cachedCjsCode) {
    const tsSource = fs.readFileSync(FUNCTIONS_SOURCE_PATH, 'utf8');
    cachedCjsCode = esbuild.transformSync(tsSource, {
      loader: 'ts',
      format: 'cjs',
      target: 'node22',
    }).code;
  }

  const moduleMap: Record<string, unknown> = {
    'firebase-admin/app': {
      getApps: () => [],
      getApp: () => ({ options: { projectId: 'gen-lang-client-0847571180' } }),
      initializeApp: (opts: { projectId?: string }) => ({ options: opts }),
    },
    'firebase-admin/auth': {
      getAuth: () => ({ verifyIdToken: vi.fn() }),
    },
    'firebase-admin/storage': {
      getStorage: () => ({ bucket: () => ({ file: () => ({}) }) }),
    },
    '@google-cloud/firestore': {
      Firestore: mockDb.MockFirestore,
      FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
    },
    'firebase-functions/params': {
      defineSecret: (name: string) => ({
        name,
        value: () => process.env[name] || '',
      }),
    },
    'firebase-functions/v2/https': {
      HttpsError: MockHttpsError,
      onCall: (
        optsOrHandler: Record<string, unknown> | ((req: unknown) => unknown),
        maybeHandler?: (req: unknown) => unknown
      ) => {
        const handler = typeof optsOrHandler === 'function' ? optsOrHandler : maybeHandler!;
        const options = typeof optsOrHandler === 'function' ? {} : optsOrHandler;
        return Object.assign(handler, { __cfOptions: options });
      },
      onRequest: (
        optsOrHandler: Record<string, unknown> | ((req: unknown, res: unknown) => unknown),
        maybeHandler?: (req: unknown, res: unknown) => unknown
      ) => {
        const handler = typeof optsOrHandler === 'function' ? optsOrHandler : maybeHandler!;
        const options = typeof optsOrHandler === 'function' ? {} : optsOrHandler;
        return Object.assign(handler, { __cfOptions: options });
      },
    },
    crypto: require('crypto'),
    qrcode: { toString: vi.fn(), toBuffer: vi.fn() },
    jspdf: { jsPDF: vi.fn() },
  };

  const mod = { exports: {} as Record<string, unknown> };
  const customRequire = (id: string) => {
    if (id in moduleMap) return moduleMap[id];
    return require(id);
  };
  const fn = new Function('require', 'module', 'exports', cachedCjsCode);
  fn(customRequire, mod, mod.exports);
  return mod.exports as {
    sendTransactionalEmail: WrappedCallable;
    createShippingRecord: WrappedCallable;
  };
}

function makeSampleOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderId: 'ord_101',
    orderNumber: 'TNX-2026-101',
    uid: 'cust_1',
    designId: 'des_1',
    profileId: 'prof_1',
    profileSlug: 'arjun-mehta',
    quantity: 1,
    cardType: 'Minimal Smart',
    subtotal: 999,
    tax: 180,
    shipping: 0,
    total: 1179,
    currency: 'INR',
    paymentStatus: 'Verified',
    orderStatus: 'Ready for Dispatch',
    printerId: 'PRINT_ALPHA',
    courierName: '',
    trackingNumber: '',
    trackingUrl: '',
    dispatchDate: '',
    shippingAddress: {
      fullName: 'Arjun Mehta',
      mobile: '9876543210',
      email: 'arjun@example.com',
      addressLine1: '100 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pinCode: '560001',
      country: 'India',
    },
    createdAt: '2026-11-28T01:00:00.000Z',
    updatedAt: '2026-11-28T01:00:00.000Z',
    ...overrides,
  };
}

describe('TapNex Dispatch Email Cloud Function & Resend Integration', () => {
  let mockDb: ReturnType<typeof createInMemoryFirestore>;
  let fns: ReturnType<typeof loadFunctionsForEmailTests>;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    mockDb = createInMemoryFirestore();

    mockDb.seedDoc('users', 'admin_1', { uid: 'admin_1', email: 'admin@tapnex.in', role: 'ADMIN', status: 'Active' });
    mockDb.seedDoc('admins', 'admin_1', { uid: 'admin_1', role: 'ADMIN', active: true });
    mockDb.seedDoc('users', 'printer_uid_1', { uid: 'printer_uid_1', email: 'print1@tapnex.in', role: 'PRINTER', status: 'Active' });
    mockDb.seedDoc('printers', 'printer_uid_1', {
      uid: 'printer_uid_1',
      printerId: 'PRINT_ALPHA',
      businessName: 'Alpha Print',
      email: 'print1@tapnex.in',
      status: 'Active',
    });
    mockDb.seedDoc('users', 'cust_1', { uid: 'cust_1', email: 'arjun@example.com', role: 'USER', status: 'Active' });
    mockDb.seedDoc('users', 'cust_2', { uid: 'cust_2', email: 'other@example.com', role: 'USER', status: 'Active' });
    mockDb.seedDoc('orders', 'ord_101', makeSampleOrder() as unknown as DocData);

    fns = loadFunctionsForEmailTests(mockDb);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  it('declares RESEND_API_KEY secret on sendTransactionalEmail Cloud Function v2', () => {
    const secrets = fns.sendTransactionalEmail.__cfOptions?.secrets || [];
    expect(secrets.some((s) => s.name === 'RESEND_API_KEY')).toBe(true);
  });

  it('1. saves dispatch, sends branded email via Resend using authoritative customer email, and logs Sent notification', async () => {
    process.env.RESEND_API_KEY = 're_test_live_secret_12345';
    process.env.RESEND_FROM_EMAIL = 'TapNex <orders@tapnex.in>';

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_msg_98765' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchSpy);

    const shippingRes = await fns.createShippingRecord({
      auth: { uid: 'printer_uid_1', token: { email_verified: true } },
      data: {
        orderId: 'ord_101',
        courierName: 'BlueDart',
        trackingNumber: 'BD99887766',
        trackingUrl: 'https://bluedart.com/track/BD99887766',
        dispatchDate: '2026-11-28',
      },
    });
    expect(shippingRes.shippingId).toBeTruthy();

    const emailRes = await fns.sendTransactionalEmail({
      auth: { uid: 'printer_uid_1', token: { email_verified: true } },
      data: {
        orderId: 'ord_101',
        templateId: 'dispatched',
        // Attempted client-side spoof of recipient email must be ignored in favor of Firestore order email
        to: 'attacker@evil.com',
      },
    });

    expect(emailRes.delivered).toBe(true);
    expect(emailRes.mode).toBe('resend_live');
    expect(emailRes.resendMessageId).toBe('re_msg_98765');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_test_live_secret_12345',
      'Content-Type': 'application/json',
    });

    const sentPayload = JSON.parse(String(init.body)) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
    };
    expect(sentPayload.from).toBe('TapNex <orders@tapnex.in>');
    expect(sentPayload.to).toEqual(['arjun@example.com']);
    expect(sentPayload.subject).toBe('Your TapNex Order Has Been Dispatched!');
    expect(sentPayload.html).toContain('Arjun Mehta');
    expect(sentPayload.html).toContain('TNX-2026-101');
    expect(sentPayload.html).toContain('BlueDart');
    expect(sentPayload.html).toContain('BD99887766');
    expect(sentPayload.html).toContain('2026-11-28');
    expect(sentPayload.html).toContain('https://bluedart.com/track/BD99887766');
    expect(sentPayload.html).toContain('Track Your Order');

    const notifications = mockDb.listCol('notifications');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      orderId: 'ord_101',
      uid: 'cust_1',
      recipientEmail: 'arjun@example.com',
      templateId: 'dispatched',
      channel: 'email',
      deliveryStatus: 'Sent',
      resendMessageId: 're_msg_98765',
      error: null,
    });
  });

  it('3. handles missing Resend credentials safely without crashing or exposing secrets', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    mockDb.seedDoc('orders', 'ord_101', makeSampleOrder({
      orderStatus: 'Dispatched',
      courierName: 'Delhivery',
      trackingNumber: 'DLV1234',
      dispatchDate: '2026-11-28',
    }) as unknown as DocData);

    const res = await fns.sendTransactionalEmail({
      auth: { uid: 'admin_1', token: { email_verified: true } },
      data: { orderId: 'ord_101', templateId: 'dispatched' },
    });

    expect(res.delivered).toBe(false);
    expect(res.mode).toBe('unconfigured');
    expect(String(res.error)).toContain('not configured');
    expect(fetchSpy).not.toHaveBeenCalled();

    const notifications = mockDb.listCol('notifications');
    expect(notifications[0]?.deliveryStatus).toBe('ConfigRequired');
  });

  it('4. rejects invalid recipient email safely and logs Failed status', async () => {
    process.env.RESEND_API_KEY = 're_test_live_secret_12345';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    mockDb.seedDoc('users', 'cust_1', { uid: 'cust_1', email: 'not-an-email', role: 'USER', status: 'Active' });
    mockDb.seedDoc('orders', 'ord_101', makeSampleOrder({
      orderStatus: 'Dispatched',
      courierName: 'DTDC',
      trackingNumber: 'DT9900',
      dispatchDate: '2026-11-28',
      shippingAddress: {
        fullName: 'Arjun Mehta',
        mobile: '9876543210',
        email: 'bad-email-format',
        addressLine1: '100 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pinCode: '560001',
        country: 'India',
      },
    }) as unknown as DocData);

    const res = await fns.sendTransactionalEmail({
      auth: { uid: 'admin_1', token: { email_verified: true } },
      data: { orderId: 'ord_101', templateId: 'dispatched' },
    });

    expect(res.delivered).toBe(false);
    expect(res.mode).toBe('invalid_email');
    expect(fetchSpy).not.toHaveBeenCalled();
    const notifications = mockDb.listCol('notifications');
    expect(notifications[0]?.deliveryStatus).toBe('Failed');
  });

  it('5. handles Resend API errors without false success or leaking API key', async () => {
    const secretVal = 're_super_secret_token_999';
    process.env.RESEND_API_KEY = secretVal;
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: `Unauthorized with key ${secretVal}` }), { status: 401 })
    );
    vi.stubGlobal('fetch', fetchSpy);

    mockDb.seedDoc('orders', 'ord_101', makeSampleOrder({
      orderStatus: 'Dispatched',
      courierName: 'BlueDart',
      trackingNumber: 'BD111',
      dispatchDate: '2026-11-28',
    }) as unknown as DocData);

    const res = await fns.sendTransactionalEmail({
      auth: { uid: 'admin_1', token: { email_verified: true } },
      data: { orderId: 'ord_101', templateId: 'dispatched' },
    });

    expect(res.delivered).toBe(false);
    expect(res.mode).toBe('resend_error');
    expect(String(res.error)).not.toContain(secretVal);

    const notifications = mockDb.listCol('notifications');
    expect(notifications[0]?.deliveryStatus).toBe('Failed');
    expect(String(notifications[0]?.error)).not.toContain(secretVal);
  });

  it('6. rejects unauthenticated callers and USER role attempting dispatched email, while allowing customer own order_confirmation', async () => {
    process.env.RESEND_API_KEY = 're_test_live_secret_12345';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 're_ok_1' }), { status: 200 }))
    );

    await expect(
      fns.sendTransactionalEmail({
        auth: null,
        data: { orderId: 'ord_101', templateId: 'dispatched' },
      })
    ).rejects.toThrow('Auth required');

    mockDb.seedDoc('orders', 'ord_101', makeSampleOrder({
      orderStatus: 'Dispatched',
      courierName: 'BlueDart',
      trackingNumber: 'BD111',
      dispatchDate: '2026-11-28',
    }) as unknown as DocData);

    await expect(
      fns.sendTransactionalEmail({
        auth: { uid: 'cust_1', token: { email_verified: true } },
        data: { orderId: 'ord_101', templateId: 'dispatched' },
      })
    ).rejects.toThrow(/confirmation emails/i);

    await expect(
      fns.sendTransactionalEmail({
        auth: { uid: 'cust_2', token: { email_verified: true } },
        data: { orderId: 'ord_101', templateId: 'order_confirmation' },
      })
    ).rejects.toThrow(/confirmation emails/i);

    const custOk = await fns.sendTransactionalEmail({
      auth: { uid: 'cust_1', token: { email_verified: true } },
      data: {
        orderId: 'ord_101',
        templateId: 'order_confirmation',
        subject: 'Order Confirmed',
        html: '<p>Confirmed</p>',
      },
    });
    expect(custOk.delivered).toBe(true);
  });

  it('7. rejects printer attempting to send dispatch email for an unassigned order or undispatched order', async () => {
    process.env.RESEND_API_KEY = 're_test_live_secret_12345';
    mockDb.seedDoc('orders', 'ord_other_printer', makeSampleOrder({
      orderId: 'ord_other_printer',
      printerId: 'PRINT_BETA',
      orderStatus: 'Dispatched',
      courierName: 'BlueDart',
      trackingNumber: 'BD222',
      dispatchDate: '2026-11-28',
    }) as unknown as DocData);

    await expect(
      fns.sendTransactionalEmail({
        auth: { uid: 'printer_uid_1', token: { email_verified: true } },
        data: { orderId: 'ord_other_printer', templateId: 'dispatched' },
      })
    ).rejects.toThrow(/assigned to its linked Print Auth ID/i);

    // Order assigned to printer_uid_1, but NOT yet dispatched
    await expect(
      fns.sendTransactionalEmail({
        auth: { uid: 'printer_uid_1', token: { email_verified: true } },
        data: { orderId: 'ord_101', templateId: 'dispatched' },
      })
    ).rejects.toThrow(/must be saved on the order before sending/i);
  });

  it('9. renders dispatched email safely with HTML escaping and omits tracking link when trackingUrl is empty or unsafe', async () => {
    process.env.RESEND_API_KEY = 're_test_live_secret_12345';
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_msg_escape' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchSpy);

    mockDb.seedDoc('orders', 'ord_101', makeSampleOrder({
      orderStatus: 'Dispatched',
      courierName: 'SafeCourier <script>alert(1)</script>',
      trackingNumber: 'TRK&123',
      trackingUrl: 'javascript:alert(1)',
      dispatchDate: '2026-11-28',
    }) as unknown as DocData);

    const res = await fns.sendTransactionalEmail({
      auth: { uid: 'admin_1', token: { email_verified: true } },
      data: { orderId: 'ord_101', templateId: 'dispatched' },
    });

    expect(res.delivered).toBe(true);
    const body = JSON.parse(String((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body)) as {
      subject: string;
      html: string;
    };
    expect(body.subject).toBe('Your TapNex Order Has Been Dispatched!');
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body.html).toContain('TRK&amp;123');
    expect(body.html).not.toContain('Track Your Order');
    expect(body.html).not.toContain('javascript:');

    const defaultDispatchedTpl = DEFAULT_EMAIL_TEMPLATES.find((t) => t.templateId === 'dispatched');
    expect(defaultDispatchedTpl?.subject).toBe('Your TapNex Order Has Been Dispatched!');
    expect(defaultDispatchedTpl?.htmlBody).toContain('{{DISPATCH_DATE}}');
    expect(defaultDispatchedTpl?.htmlBody).toContain('{{CUSTOMER_NAME}}');
  });

  it('10. supports admin/superadmin test_email using explicit recipient and rejects USER callers', async () => {
    process.env.RESEND_API_KEY = 're_test_live_secret_12345';
    process.env.RESEND_FROM_EMAIL = 'TapNex <orders@tapnex.in>';

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_test_1' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      fns.sendTransactionalEmail({
        auth: { uid: 'cust_1', token: { email_verified: true } },
        data: {
          templateId: 'test_email',
          to: 'verify@example.com',
        },
      })
    ).rejects.toThrow(/Administrator privileges are required/i);

    const res = await fns.sendTransactionalEmail({
      auth: { uid: 'admin_1', token: { email_verified: true } },
      data: {
        templateId: 'test_email',
        to: 'verify@example.com',
        variables: {
          CUSTOMER_NAME: 'TapNex Admin',
        },
      },
    });

    expect(res.delivered).toBe(true);
    expect(res.mode).toBe('resend_live');
    expect(res.resendMessageId).toBe('re_test_1');

    const sentPayload = JSON.parse(String((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body)) as {
      to: string[];
      subject: string;
      html: string;
    };
    expect(sentPayload.to).toEqual(['verify@example.com']);
    expect(sentPayload.subject).toBe('TapNex Resend Email Configuration Test');
    expect(sentPayload.html).toContain('TapNex');
  });

  it('11. renders branded transactional HTML fallback for all lifecycle templates when subject/html are omitted', async () => {
    process.env.RESEND_API_KEY = 're_test_live_secret_12345';
    process.env.RESEND_FROM_EMAIL = 'TapNex <orders@tapnex.in>';

    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 're_tpl_ok' }), { status: 200 }))
    );
    vi.stubGlobal('fetch', fetchSpy);

    const lifecycleTemplates = [
      'order_confirmation',
      'payment_success',
      'printing_started',
      'delivered',
      'order_cancelled',
      'refund_notification',
    ] as const;

    for (const templateId of lifecycleTemplates) {
      const res = await fns.sendTransactionalEmail({
        auth: { uid: 'admin_1', token: { email_verified: true } },
        data: {
          orderId: 'ord_101',
          templateId,
          variables: {
            AMOUNT: 'INR 1179',
          },
        },
      });
      expect(res.delivered).toBe(true);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(lifecycleTemplates.length);
    for (let i = 0; i < lifecycleTemplates.length; i += 1) {
      const payload = JSON.parse(String((fetchSpy.mock.calls[i] as [string, RequestInit])[1].body)) as {
        to: string[];
        subject: string;
        html: string;
      };
      expect(payload.to).toEqual(['arjun@example.com']);
      expect(payload.subject.length).toBeGreaterThan(5);
      expect(payload.html).toContain('TNX-2026-101');
      expect(payload.html).toContain('TapNex');
    }
  });

  it('12. uses emailTemplates/sender_config Firestore override when RESEND_FROM_EMAIL env var is unset', async () => {
    process.env.RESEND_API_KEY = 're_test_live_secret_12345';
    delete process.env.RESEND_FROM_EMAIL;

    mockDb.seedDoc('emailTemplates', 'sender_config', {
      fromName: 'TapNex Dispatch',
      fromEmail: 'dispatch@custom-domain.in',
    });

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_sender_override' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchSpy);

    const res = await fns.sendTransactionalEmail({
      auth: { uid: 'admin_1', token: { email_verified: true } },
      data: {
        orderId: 'ord_101',
        templateId: 'order_confirmation',
      },
    });

    expect(res.delivered).toBe(true);
    const sentPayload = JSON.parse(String((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body)) as {
      from: string;
    };
    expect(sentPayload.from).toBe('TapNex Dispatch <dispatch@custom-domain.in>');
  });
});

describe('Frontend Decoupled Dispatch Save, Email Delivery, Case A/B/C & Manual Retry', () => {
  it('2 & 10. keeps dispatch saved (never rolls back) and shows Case B message when callable returns delivered=false without throwing', async () => {
    const order = makeSampleOrder();
    const createShippingRecordFn = vi.fn().mockResolvedValue({ shippingId: 'shp_1' });
    const sendEmailFn = vi.fn().mockResolvedValue({
      delivered: false,
      mode: 'unconfigured',
      error: 'Resend API key is not configured.',
    });
    const onDispatchSaved = vi.fn();
    const onEmailSuccess = vi.fn();
    const onEmailFailure = vi.fn();
    const onSaveFailure = vi.fn();

    const outcome = await executeDispatchWithNotification({
      order,
      input: {
        orderId: order.orderId,
        courierName: 'BlueDart',
        trackingNumber: 'BD12345',
        trackingUrl: '',
        dispatchDate: '2026-11-28',
      },
      createShippingRecordFn,
      sendEmailFn,
      onDispatchSaved,
      onEmailSuccess,
      onEmailFailure,
      onSaveFailure,
    });

    expect(createShippingRecordFn).toHaveBeenCalledTimes(1);
    expect(onDispatchSaved).toHaveBeenCalledTimes(1);
    expect(onDispatchSaved.mock.calls[0][0]).toMatchObject({
      orderStatus: 'Dispatched',
      courierName: 'BlueDart',
      trackingNumber: 'BD12345',
    });
    expect(outcome.case).toBe('B');
    expect(outcome.dispatchSaved).toBe(true);
    expect(outcome.emailDelivered).toBe(false);
    expect(onEmailSuccess).not.toHaveBeenCalled();
    expect(onSaveFailure).not.toHaveBeenCalled();
    expect(onEmailFailure).toHaveBeenCalledWith(
      DISPATCH_SUCCESS_EMAIL_FAILED,
      expect.objectContaining({ delivered: false })
    );
  });

  it('Case A & Case C: reports exact Case A when email delivered=true, and exact Case C when dispatch save fails without sending email', async () => {
    const order = makeSampleOrder();
    const sendOkFn = vi.fn().mockResolvedValue({ delivered: true, mode: 'resend_live', resendMessageId: 're_1' });
    const onEmailSuccess = vi.fn();

    const okOutcome = await executeDispatchWithNotification({
      order,
      input: {
        orderId: order.orderId,
        courierName: 'Delhivery',
        trackingNumber: 'DLV999',
        trackingUrl: 'https://delhivery.com/track/DLV999',
        dispatchDate: '2026-11-28',
      },
      createShippingRecordFn: vi.fn().mockResolvedValue({ shippingId: 'shp_2' }),
      sendEmailFn: sendOkFn,
      onDispatchSaved: vi.fn(),
      onEmailSuccess,
      onEmailFailure: vi.fn(),
      onSaveFailure: vi.fn(),
    });

    expect(okOutcome.case).toBe('A');
    expect(onEmailSuccess).toHaveBeenCalledWith(
      DISPATCH_SUCCESS_EMAIL_SENT,
      expect.objectContaining({ delivered: true })
    );

    const onSaveFailure = vi.fn();
    const neverEmailFn = vi.fn();
    const failOutcome = await executeDispatchWithNotification({
      order,
      input: {
        orderId: order.orderId,
        courierName: 'Delhivery',
        trackingNumber: 'DLV999',
        dispatchDate: '2026-11-28',
      },
      createShippingRecordFn: vi.fn().mockRejectedValue(new Error('Network offline')),
      sendEmailFn: neverEmailFn,
      onDispatchSaved: vi.fn(),
      onEmailSuccess: vi.fn(),
      onEmailFailure: vi.fn(),
      onSaveFailure,
    });

    expect(failOutcome.case).toBe('C');
    expect(failOutcome.dispatchSaved).toBe(false);
    expect(neverEmailFn).not.toHaveBeenCalled();
    expect(onSaveFailure).toHaveBeenCalledWith(DISPATCH_SAVE_FAILED, expect.any(Error));
  });

  it('8. manual retry resends email without duplicating shipping record and FulfilmentTimeline renders Retry Dispatch Email button', async () => {
    const dispatchedOrder = makeSampleOrder({
      orderStatus: 'Dispatched',
      courierName: 'BlueDart',
      trackingNumber: 'BD777',
      dispatchDate: '2026-11-28',
    });
    const createShippingRecordFn = vi.fn();
    const sendEmailFn = vi.fn().mockResolvedValue({
      delivered: true,
      mode: 'resend_live',
      resendMessageId: 're_retry_ok',
    });
    const onEmailSuccess = vi.fn();
    const onEmailFailure = vi.fn();

    const retryRes = await executeRetryDispatchEmail({
      order: dispatchedOrder,
      sendEmailFn,
      onEmailSuccess,
      onEmailFailure,
    });

    expect(retryRes.delivered).toBe(true);
    expect(sendEmailFn).toHaveBeenCalledTimes(1);
    expect(createShippingRecordFn).not.toHaveBeenCalled();
    expect(onEmailSuccess).toHaveBeenCalledWith(
      DISPATCH_SUCCESS_EMAIL_SENT,
      expect.objectContaining({ resendMessageId: 're_retry_ok' })
    );

    const onRetryAction = vi.fn();
    const tree = FulfilmentTimeline({
      currentStatus: 'Dispatched',
      interactive: true,
      warningMessage: DISPATCH_SUCCESS_EMAIL_FAILED,
      retryActionLabel: 'Retry Dispatch Email',
      onRetryAction,
    });
    const serialized = JSON.stringify(tree);
    expect(serialized).toContain('Retry Dispatch Email');
    expect(serialized).toContain(DISPATCH_SUCCESS_EMAIL_FAILED);

    // Ensure client code never references /api/email/send or RESEND_API_KEY
    const firestoreServiceSrc = fs.readFileSync(
      path.resolve(__dirname, '../src/lib/firestoreService.ts'),
      'utf8'
    );
    expect(firestoreServiceSrc).toContain("httpsCallable");
    expect(firestoreServiceSrc).toContain("'sendTransactionalEmail'");
    expect(firestoreServiceSrc).not.toContain('/api/email/send');
    expect(firestoreServiceSrc).not.toContain('RESEND_API_KEY');
  });

  it('sendAndLogTransactionalEmail calls Firebase httpsCallable(functions, "sendTransactionalEmail") instead of /api/email/send', async () => {
    vi.resetModules();
    const getIdTokenMock = vi.fn().mockResolvedValue('tok_dispatch_1');
    const callableSpy = vi.fn().mockResolvedValue({
      data: {
        delivered: true,
        mode: 'resend_live',
        notificationId: 'ntf_srv_1',
        resendMessageId: 're_live_1',
      },
    });
    const httpsCallableSpy = vi.fn(() => callableSpy);

    vi.doMock('firebase/functions', () => ({
      httpsCallable: httpsCallableSpy,
    }));
    vi.doMock('../src/lib/firebase', () => ({
      auth: { currentUser: { getIdToken: getIdTokenMock } },
      db: {},
      functions: { app: { options: { projectId: 'gen-lang-client-0847571180' } } },
      handleFirestoreError: vi.fn(),
      OperationType: { LIST: 'list', GET: 'get', WRITE: 'write', CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
    }));

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { sendAndLogTransactionalEmail } = await import('../src/lib/firestoreService');
    const result = await sendAndLogTransactionalEmail({
      orderId: 'ord_101',
      uid: 'cust_1',
      to: 'arjun@example.com',
      templateId: 'dispatched',
      variables: {
        CUSTOMER_NAME: 'Arjun Mehta',
        ORDER_NUMBER: 'TNX-2026-101',
        COURIER_NAME: 'BlueDart',
        TRACKING_NUMBER: 'BD777',
        DISPATCH_DATE: '2026-11-28',
      },
    });

    expect(getIdTokenMock).toHaveBeenCalledTimes(1);
    expect(httpsCallableSpy).toHaveBeenCalledWith(expect.anything(), 'sendTransactionalEmail');
    expect(callableSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord_101',
        uid: 'cust_1',
        templateId: 'dispatched',
      })
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      delivered: true,
      mode: 'resend_live',
      notificationId: 'ntf_srv_1',
      resendMessageId: 're_live_1',
      error: undefined,
    });
  });

  it('formatEmailDeliveryFailureReason returns actionable reasons for unconfigured, invalid_email, invalid_sender, and explicit errors', () => {
    expect(formatEmailDeliveryFailureReason(null)).toBe('');
    expect(formatEmailDeliveryFailureReason(undefined)).toBe('');
    expect(formatEmailDeliveryFailureReason({ delivered: true, mode: 'resend_live' })).toBe('');

    expect(
      formatEmailDeliveryFailureReason({
        delivered: false,
        mode: 'unconfigured',
        error: 'Resend API key is missing.',
      })
    ).toContain('Firebase Functions Secrets');

    expect(
      formatEmailDeliveryFailureReason({
        delivered: false,
        mode: 'unconfigured',
      })
    ).toContain('RESEND_API_KEY');

    expect(
      formatEmailDeliveryFailureReason({
        delivered: false,
        mode: 'invalid_email',
      })
    ).toContain('missing or invalid');

    expect(
      formatEmailDeliveryFailureReason({
        delivered: false,
        mode: 'invalid_sender',
      })
    ).toContain('RESEND_FROM_EMAIL');

    expect(
      formatEmailDeliveryFailureReason({
        delivered: false,
        mode: 'resend_error',
        error: 'Domain tapnex.in is not verified in Resend.',
      })
    ).toBe('Domain tapnex.in is not verified in Resend.');
  });
});
