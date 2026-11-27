import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable, Writable } from 'stream';
import * as esbuild from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  const versions = new Map<string, number>();

  const getVersion = (docPath: string): number => versions.get(docPath) || 0;
  const bumpVersion = (docPath: string) => {
    versions.set(docPath, getVersion(docPath) + 1);
  };

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
        out[k] = '2026-11-25T14:00:00.000Z';
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
        const col = getColMap(collectionName);
        const existing = col.get(docId);
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
        bumpVersion(docPath);
      },
      async update(data: DocData) {
        const col = getColMap(collectionName);
        if (!col.has(docId)) {
          throw new Error(`Document ${collectionName}/${docId} does not exist for update.`);
        }
        col.set(docId, { ...col.get(docId)!, ...resolveValues(data) });
        bumpVersion(docPath);
      },
      async delete() {
        getColMap(collectionName).delete(docId);
        bumpVersion(docPath);
      },
    };
    return ref;
  };

  let autoIdCounter = 0;

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
          const col = getColMap(name);
          const docs = Array.from(col.entries()).map(([id, data]) => {
            const ref = makeDocRef(name, id);
            return {
              id,
              exists: true,
              ref,
              data: () => structuredClone(data),
            };
          });
          return { docs, empty: docs.length === 0, size: docs.length };
        },
        where: (field: string, op: string, value: unknown) => {
          const filters: Array<{ field: string; op: string; value: unknown }> = [
            { field, op, value },
          ];
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
              const col = getColMap(name);
              const matched: MockDocSnap[] = [];
              for (const [id, data] of col.entries()) {
                const ok = filters.every((f) => f.op === '==' && data[f.field] === f.value);
                if (ok) {
                  const ref = makeDocRef(name, id);
                  matched.push({
                    id,
                    exists: true,
                    ref,
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

    async runTransaction<T>(fn: (tx: {
      get: (ref: MockDocRef) => Promise<MockDocSnap>;
      set: (ref: MockDocRef, data: DocData, options?: { merge?: boolean }) => void;
      update: (ref: MockDocRef, data: DocData) => void;
      delete: (ref: MockDocRef) => void;
    }) => Promise<T>): Promise<T> {
      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let wrote = false;
        const readVersions = new Map<string, number>();
        const pendingOps: Array<() => Promise<void>> = [];
        const tx = {
          get: async (ref: MockDocRef) => {
            if (wrote) {
              throw new Error('Firestore transactions require all reads to be executed before writes.');
            }
            if (!readVersions.has(ref.path)) {
              readVersions.set(ref.path, getVersion(ref.path));
            }
            return ref.get();
          },
          set: (ref: MockDocRef, data: DocData, options?: { merge?: boolean }) => {
            wrote = true;
            pendingOps.push(() => ref.set(data, options));
          },
          update: (ref: MockDocRef, data: DocData) => {
            wrote = true;
            pendingOps.push(() => ref.update(data));
          },
          delete: (ref: MockDocRef) => {
            wrote = true;
            pendingOps.push(() => ref.delete());
          },
        };
        const result = await fn(tx);
        let conflicted = false;
        for (const [docPath, expectedVer] of readVersions.entries()) {
          if (getVersion(docPath) !== expectedVer) {
            conflicted = true;
            break;
          }
        }
        if (conflicted) {
          if (attempt === maxAttempts) {
            throw new Error('Transaction contention retry limit exceeded.');
          }
          continue;
        }
        for (const op of pendingOps) {
          await op();
        }
        return result;
      }
      throw new Error('Unreachable transaction exit.');
    }
  }

  const storageFiles = new Map<
    string,
    {
      buffer: Buffer;
      contentType: string;
      metadata: Record<string, unknown>;
      mockStreamBehavior?: 'error-before-data' | 'error-after-chunk';
    }
  >();

  return {
    store,
    storageFiles,
    MockFirestore,
    seedDoc: (col: string, id: string, data: DocData) => {
      getColMap(col).set(id, structuredClone(data));
      bumpVersion(`${col}/${id}`);
    },
    readDoc: (col: string, id: string) => {
      const val = getColMap(col).get(id);
      return val ? structuredClone(val) : undefined;
    },
    clearAll: () => {
      store.clear();
      versions.clear();
      storageFiles.clear();
    },
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

interface WrappedRequest {
  (
    req: {
      method: string;
      headers: Record<string, string | undefined>;
      rawBody?: Buffer | string;
    },
    res: {
      status: (code: number) => { json: (body: unknown) => void; send: (body: unknown) => void };
      json: (body: unknown) => void;
    }
  ): Promise<void>;
  __cfOptions?: { secrets?: Array<{ name: string }> };
}

interface WrappedDispatchHttpRequest {
  (
    req: {
      method: string;
      headers: Record<string, string | undefined>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    },
    res: ReturnType<typeof createStreamingMockRes>
  ): Promise<void>;
  __cfOptions?: { secrets?: Array<{ name: string }> };
}

interface FunctionsExports {
  createUserProfile: WrappedCallable;
  generatePurchasedQr: WrappedCallable;
  generateAdminQr: WrappedCallable;
  generatePrintReadyPdf: WrappedCallable;
  assignPrinter: WrappedCallable;
  updateOrderStatus: WrappedCallable;
  adminReconcileOrderPayment: WrappedCallable;
  adminReconcileProfilePayment: WrappedCallable;
  adminEnsureOrderQr: WrappedCallable;
  adminSendDesignToPrint: WrappedCallable;
  exportAdminReport: WrappedCallable;
  uploadDispatchDoc: WrappedCallable;
  downloadDispatchDoc: WrappedDispatchHttpRequest;
  deleteDispatchDoc: WrappedCallable;
  createPaymentOrder: WrappedCallable;
  verifyPayment: WrappedCallable;
  razorpayWebhook: WrappedRequest;
}

const FUNCTIONS_SOURCE_PATH = path.resolve(__dirname, '../functions/src/index.ts');
let cachedCjsCode: string | null = null;

function makeTestIdToken(payload: {
  uid?: string;
  email?: string;
  email_verified?: boolean;
  revoked?: boolean;
  simulateMissingUid?: boolean;
}): string {
  return `token:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function loadFunctionsWithMocks(mockDbState: ReturnType<typeof createInMemoryFirestore>): FunctionsExports {
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
      getAuth: () => ({
        verifyIdToken: async (token: string, _checkRevoked?: boolean) => {
          if (!token || !token.startsWith('token:')) {
            const err = new Error('Invalid Firebase ID token');
            (err as Error & { code?: string }).code = 'auth/invalid-id-token';
            throw err;
          }
          const rawJson = Buffer.from(token.slice('token:'.length), 'base64url').toString('utf8');
          const decoded = JSON.parse(rawJson) as Record<string, unknown>;
          if (decoded?.simulateMissingUid === true) {
            return { email: decoded.email || 'nouid@tapnex.in', email_verified: true };
          }
          if (!decoded || typeof decoded.uid !== 'string' || !decoded.uid || decoded.revoked === true) {
            const err = new Error('Revoked or malformed Firebase ID token');
            (err as Error & { code?: string }).code = 'auth/id-token-revoked';
            throw err;
          }
          return decoded;
        },
      }),
    },
    'firebase-admin/storage': {
      getStorage: () => ({
        bucket: () => ({
          file: (filePath: string) => ({
            save: async (buf: Buffer, opts?: { contentType?: string; metadata?: Record<string, unknown> }) => {
              mockDbState.storageFiles.set(filePath, {
                buffer: Buffer.from(buf),
                contentType: String(opts?.contentType || opts?.metadata?.contentType || ''),
                metadata: structuredClone((opts?.metadata || {}) as Record<string, unknown>),
              });
            },
            exists: async (): Promise<[boolean]> => [mockDbState.storageFiles.has(filePath)],
            getMetadata: async (): Promise<[Record<string, unknown>]> => {
              const entry = mockDbState.storageFiles.get(filePath);
              return [entry ? structuredClone(entry.metadata) : {}];
            },
            getSignedUrl: async (): Promise<[string]> => {
              throw new Error('getSignedUrl must never be called for dispatchDocs');
            },
            createReadStream: () => {
              const entry = mockDbState.storageFiles.get(filePath);
              if (!entry) {
                return new Readable({
                  read() {
                    this.destroy(new Error(`No such object: ${filePath}`));
                  },
                });
              }
              if (entry.mockStreamBehavior === 'error-before-data') {
                return new Readable({
                  read() {
                    this.destroy(new Error('Simulated storage read error before headers'));
                  },
                });
              }
              if (entry.mockStreamBehavior === 'error-after-chunk') {
                let step = 0;
                return new Readable({
                  read() {
                    if (step === 0) {
                      step += 1;
                      this.push(entry.buffer.subarray(0, Math.min(8, entry.buffer.length)));
                      return;
                    }
                    if (step === 1) {
                      step += 1;
                      process.nextTick(() => {
                        this.destroy(new Error('Simulated storage disconnect after headers'));
                      });
                    }
                  },
                });
              }
              return Readable.from([entry.buffer]);
            },
            delete: async () => {
              mockDbState.storageFiles.delete(filePath);
              return [{}];
            },
          }),
        }),
      }),
    },
    '@google-cloud/firestore': {
      Firestore: mockDbState.MockFirestore,
      FieldValue: {
        serverTimestamp: () => ({ __serverTimestamp: true }),
      },
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
        return Object.assign(handler, { __cfOptions: options, __cfType: 'onCall' });
      },
      onRequest: (
        optsOrHandler: Record<string, unknown> | ((req: unknown, res: unknown) => unknown),
        maybeHandler?: (req: unknown, res: unknown) => unknown
      ) => {
        const handler = typeof optsOrHandler === 'function' ? optsOrHandler : maybeHandler!;
        const options = typeof optsOrHandler === 'function' ? {} : optsOrHandler;
        return Object.assign(handler, { __cfOptions: options, __cfType: 'onRequest' });
      },
    },
    crypto,
    qrcode: {
      toString: async () => '<svg></svg>',
      toBuffer: async () => Buffer.from([]),
    },
    jspdf: {
      jsPDF: class {},
    },
  };

  const cjsModule = { exports: {} as FunctionsExports };
  const customRequire = (id: string) => {
    if (id in moduleMap) return moduleMap[id];
    throw new Error(`Unexpected module import in functions/src/index.ts test harness: ${id}`);
  };

  const fn = new Function('exports', 'require', 'module', cachedCjsCode);
  fn(cjsModule.exports, customRequire, cjsModule);
  return cjsModule.exports;
}

const KEY_ID = 'rzp_live_tapnex123456';
const KEY_SECRET = 'rzp_secret_unit_test_abcdef123456';
const WEBHOOK_SECRET = 'whsec_unit_test_secret_987654';

function signPayment(razorpayOrderId: string, razorpayPaymentId: string, secret = KEY_SECRET): string {
  return crypto.createHmac('sha256', secret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
}

function signWebhook(rawBody: Buffer, secret = WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function createMockRes() {
  let statusCode = 200;
  let body: unknown = undefined;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
    },
    send(payload: unknown) {
      body = payload;
    },
    getStatus: () => statusCode,
    getBody: () => body,
  };
  return res;
}

function createStreamingMockRes() {
  let statusCode = 200;
  let jsonBody: unknown = undefined;
  const chunks: Buffer[] = [];
  const headers = new Map<string, string>();
  let headersSent = false;

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      headersSent = true;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  const res = Object.assign(stream, {
    headersSent: false,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), String(value));
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    getHeaders() {
      return Object.fromEntries(headers.entries());
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      headersSent = true;
      headers.set('content-type', 'application/json');
      jsonBody = payload;
      stream.end();
    },
    send(payload: unknown) {
      headersSent = true;
      jsonBody = payload;
      if (typeof payload === 'string' && payload.length > 0) {
        chunks.push(Buffer.from(payload, 'utf8'));
      } else if (Buffer.isBuffer(payload)) {
        chunks.push(payload);
      }
      stream.end();
    },
    getStatus: () => statusCode,
    getBody: () => jsonBody,
    getBuffer: () => Buffer.concat(chunks),
  });

  Object.defineProperty(res, 'headersSent', {
    get: () => headersSent,
    enumerable: true,
  });

  return res;
}

function seedBaselineCatalog(mockDbState: ReturnType<typeof createInMemoryFirestore>) {
  mockDbState.seedDoc('appSettings', 'global', {
    settingId: 'global',
    taxRatePercent: 18,
    shippingFeeInr: 99,
    paymentGateways: {
      razorpay: { id: 'razorpay', enabled: true, mode: 'live' },
    },
  });

  mockDbState.seedDoc('cardTemplates', 'minimal-white', {
    templateId: 'minimal-white',
    name: 'Minimal Crisp White',
    category: 'Minimal',
    designTier: 'minimal',
    pricingMode: 'card_tiers',
    priceInr: 999,
    active: true,
  });

  mockDbState.seedDoc('cardTemplates', 'premium-navy', {
    templateId: 'premium-navy',
    name: 'Executive Navy Obsidian',
    category: 'Executive',
    designTier: 'designer',
    pricingMode: 'card_tiers',
    priceInr: 1499,
    active: true,
  });

  mockDbState.seedDoc('cardTemplates', 'pet-dog-tag-classic', {
    templateId: 'pet-dog-tag-classic',
    name: 'Classic Dog Tag',
    category: 'Pets Recovery',
    designTier: 'designer',
    pricingMode: 'fixed_pack',
    priceInr: 599,
    active: true,
  });

  mockDbState.seedDoc('shopProducts', 'prod-helmet-safety-tag', {
    productId: 'prod-helmet-safety-tag',
    name: 'Helmet & Bike QR Sticker Pack',
    priceInr: 299,
    visibleOnShop: true,
    inStock: true,
  });

  mockDbState.seedDoc('shopProducts', 'prod-pet-collar-tag', {
    productId: 'prod-pet-collar-tag',
    name: 'Guardian Dog Tags (Pack of 2)',
    priceInr: 599,
    visibleOnShop: true,
    inStock: true,
  });
}

describe('Phase 2A Razorpay Backend Security & Pricing', () => {
  const mockDbState = createInMemoryFirestore();
  let mod: FunctionsExports;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockDbState.clearAll();
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.FIRESTORE_DATABASE_ID;
    mod = loadFunctionsWithMocks(mockDbState);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('binds Razorpay Secret Manager params only to the payment Cloud Functions', () => {
    const createSecrets = (mod.createPaymentOrder.__cfOptions?.secrets || []).map((s) => s.name);
    const verifySecrets = (mod.verifyPayment.__cfOptions?.secrets || []).map((s) => s.name);
    const webhookSecrets = (mod.razorpayWebhook.__cfOptions?.secrets || []).map((s) => s.name);

    expect(createSecrets).toEqual(['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']);
    expect(verifySecrets).toEqual(['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']);
    expect(webhookSecrets).toEqual([
      'RAZORPAY_WEBHOOK_SECRET',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
    ]);

    expect(mod.createUserProfile.__cfOptions?.secrets).toBeUndefined();
    expect(mod.generateAdminQr.__cfOptions?.secrets).toBeUndefined();
    expect(mod.exportAdminReport.__cfOptions?.secrets).toBeUndefined();
  });

  describe('createPaymentOrder', () => {
    it('rejects unauthenticated requests and non-owners', async () => {
      seedBaselineCatalog(mockDbState);
      mockDbState.seedDoc('orders', 'ord_1', {
        orderId: 'ord_1',
        uid: 'user_owner',
        designId: 'des_1',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
        total: 688,
      });

      await expect(mod.createPaymentOrder({ auth: null, data: { orderId: 'ord_1' } })).rejects.toMatchObject({
        code: 'unauthenticated',
      });

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_attacker' }, data: { orderId: 'ord_1' } })
      ).rejects.toMatchObject({
        code: 'permission-denied',
      });
    });

    it('fails closed when authoritative appSettings/global, cardTemplates, or shopProducts are missing', async () => {
      mockDbState.seedDoc('orders', 'ord_missing_settings', {
        orderId: 'ord_missing_settings',
        uid: 'user_1',
        designId: 'des_1',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
        total: 688,
      });

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_missing_settings' } })
      ).rejects.toThrow(/appSettings\/global/);

      seedBaselineCatalog(mockDbState);
      mockDbState.seedDoc('cardDesigns', 'des_missing_tpl', {
        designId: 'des_missing_tpl',
        uid: 'user_1',
        orderId: 'ord_missing_tpl',
        locked: true,
        templateId: 'nonexistent-tpl',
        cardTechnology: 'qr_only',
      });
      mockDbState.seedDoc('orders', 'ord_missing_tpl', {
        orderId: 'ord_missing_tpl',
        uid: 'user_1',
        designId: 'des_missing_tpl',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
        total: 688,
      });

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_missing_tpl' } })
      ).rejects.toThrow(/cardTemplates\/nonexistent-tpl/);

      mockDbState.seedDoc('orders', 'ord_missing_prod', {
        orderId: 'ord_missing_prod',
        uid: 'user_1',
        designId: 'shop_direct',
        orderSource: 'shop',
        quantity: 1,
        shopItems: [{ productId: 'prod-deleted', quantity: 1, priceInr: 1 }],
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
        total: 1,
      });

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_missing_prod' } })
      ).rejects.toThrow(/shopProducts\/prod-deleted/);
    });

    it('rejects invalid currency, quantity, and non-pending order status', async () => {
      seedBaselineCatalog(mockDbState);
      mockDbState.seedDoc('cardDesigns', 'des_1', {
        designId: 'des_1',
        uid: 'user_1',
        orderId: 'ord_zero_qty',
        locked: true,
        templateId: 'minimal-white',
        cardTechnology: 'qr_only',
      });

      mockDbState.seedDoc('orders', 'ord_usd', {
        orderId: 'ord_usd',
        uid: 'user_1',
        designId: 'des_1',
        quantity: 1,
        currency: 'USD',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });
      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_usd' } })
      ).rejects.toMatchObject({ code: 'failed-precondition' });

      mockDbState.seedDoc('orders', 'ord_paid', {
        orderId: 'ord_paid',
        uid: 'user_1',
        designId: 'des_1',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Verified',
        orderStatus: 'Payment Successful',
      });
      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_paid' } })
      ).rejects.toMatchObject({ code: 'failed-precondition' });

      mockDbState.seedDoc('orders', 'ord_zero_qty', {
        orderId: 'ord_zero_qty',
        uid: 'user_1',
        designId: 'des_1',
        quantity: 0,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });
      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_zero_qty' } })
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('ignores browser amountInr and tampered orders.total, derives authoritative Studio pricing, and calls Razorpay Orders API', async () => {
      seedBaselineCatalog(mockDbState);
      mockDbState.seedDoc('cardDesigns', 'des_studio', {
        designId: 'des_studio',
        uid: 'user_1',
        orderId: 'ord_studio_tampered',
        locked: true,
        templateId: 'premium-navy',
        cardTechnology: 'qr_smart', // Designer Smart Card = 1499 INR
      });
      // Tampered order total = ₹10 (instead of 1499 * 2 = 2998 + 540 GST + 99 shipping = 3637)
      mockDbState.seedDoc('orders', 'ord_studio_tampered', {
        orderId: 'ord_studio_tampered',
        orderNumber: 'TNX-2026-10001',
        uid: 'user_1',
        profileId: 'prof_1',
        profileSlug: 'aarav',
        designId: 'des_studio',
        quantity: 2,
        total: 10,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });

      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const sent = JSON.parse(String(init?.body || '{}'));
        expect(sent.amount).toBe(363700);
        expect(sent.currency).toBe('INR');
        return new Response(
          JSON.stringify({
            id: 'order_RzpStudio12345',
            amount: 363700,
            currency: 'INR',
            status: 'created',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const res = await mod.createPaymentOrder({
        auth: { uid: 'user_1' },
        data: { orderId: 'ord_studio_tampered', amountInr: 1 },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject({
        gatewayOrderId: 'order_RzpStudio12345',
        amountPaise: 363700,
        currency: 'INR',
        keyId: KEY_ID,
        subtotal: 2998,
        tax: 540,
        shipping: 99,
        total: 3637,
      });

      const savedOrder = mockDbState.readDoc('orders', 'ord_studio_tampered');
      expect(savedOrder?.razorpayOrderId).toBe('order_RzpStudio12345');
      expect(savedOrder?.razorpayAmountPaise).toBe(363700);
      expect(savedOrder?.total).toBe(3637);

      const savedPay = mockDbState.readDoc('payments', 'ord_studio_tampered');
      expect(savedPay?.status).toBe('Created');
      expect(savedPay?.gatewayOrderId).toBe('order_RzpStudio12345');
      expect(savedPay?.amountPaise).toBe(363700);
    });

    it('derives authoritative Shop pricing from shopProducts ignoring client line prices', async () => {
      seedBaselineCatalog(mockDbState);
      // 2x 299 + 1x 599 = 1197 subtotal -> round(1197*0.18)=215 GST + 99 shipping = 1511 INR
      mockDbState.seedDoc('orders', 'ord_shop_1', {
        orderId: 'ord_shop_1',
        orderNumber: 'TNX-SHOP-9001',
        uid: 'user_shop',
        designId: 'shop_direct',
        orderSource: 'shop',
        quantity: 3,
        shopItems: [
          { productId: 'prod-helmet-safety-tag', quantity: 2, priceInr: 1 },
          { productId: 'prod-pet-collar-tag', quantity: 1, priceInr: 1 },
        ],
        total: 3,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });

      globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        const sent = JSON.parse(String(init?.body || '{}'));
        expect(sent.amount).toBe(151100);
        return new Response(
          JSON.stringify({ id: 'order_RzpShop998877', amount: 151100, currency: 'INR' }),
          { status: 200 }
        );
      }) as unknown as typeof fetch;

      const res = await mod.createPaymentOrder({
        auth: { uid: 'user_shop' },
        data: { orderId: 'ord_shop_1', amountInr: 3 },
      });

      expect(res.gatewayOrderId).toBe('order_RzpShop998877');
      expect(res.amountPaise).toBe(151100);
      expect(mockDbState.readDoc('orders', 'ord_shop_1')?.total).toBe(1511);
    });

    it('rejects unlocked or incorrectly linked Studio designs while Shop orders remain unaffected', async () => {
      seedBaselineCatalog(mockDbState);
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      mockDbState.seedDoc('cardDesigns', 'des_unlocked', {
        designId: 'des_unlocked',
        uid: 'user_1',
        orderId: 'ord_unlocked',
        locked: false,
        templateId: 'minimal-white',
        cardTechnology: 'qr_only',
      });
      mockDbState.seedDoc('orders', 'ord_unlocked', {
        orderId: 'ord_unlocked',
        uid: 'user_1',
        designId: 'des_unlocked',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_unlocked' } })
      ).rejects.toThrow(/must be locked/i);

      mockDbState.seedDoc('cardDesigns', 'des_other_order', {
        designId: 'des_other_order',
        uid: 'user_1',
        orderId: 'ord_different_999',
        locked: true,
        templateId: 'minimal-white',
        cardTechnology: 'qr_only',
      });
      mockDbState.seedDoc('orders', 'ord_wrong_link', {
        orderId: 'ord_wrong_link',
        uid: 'user_1',
        designId: 'des_other_order',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_wrong_link' } })
      ).rejects.toThrow(/not linked to order ord_wrong_link/i);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reuses an existing valid Razorpay order after API verification without creating a replacement', async () => {
      seedBaselineCatalog(mockDbState);
      mockDbState.seedDoc('cardDesigns', 'des_reuse', {
        designId: 'des_reuse',
        uid: 'user_1',
        orderId: 'ord_reuse_1',
        locked: true,
        templateId: 'minimal-white',
        cardTechnology: 'qr_only', // 499 + round(499*0.18=90) + 99 = 688 INR (68800 paise)
      });
      mockDbState.seedDoc('orders', 'ord_reuse_1', {
        orderId: 'ord_reuse_1',
        uid: 'user_1',
        designId: 'des_reuse',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
        razorpayOrderId: 'order_RzpExisting111',
        razorpayAmountPaise: 68800,
        total: 688,
      });

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe('https://api.razorpay.com/v1/orders/order_RzpExisting111');
        expect(init?.method).toBe('GET');
        return new Response(
          JSON.stringify({
            id: 'order_RzpExisting111',
            amount: 68800,
            amount_paid: 0,
            currency: 'INR',
            status: 'created',
          }),
          { status: 200 }
        );
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const res = await mod.createPaymentOrder({
        auth: { uid: 'user_1' },
        data: { orderId: 'ord_reuse_1' },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject({
        gatewayOrderId: 'order_RzpExisting111',
        amountPaise: 68800,
        currency: 'INR',
        reused: true,
      });
      expect(mockDbState.readDoc('orders', 'ord_reuse_1')?.razorpayOrderId).toBe(
        'order_RzpExisting111'
      );
    });

    it('rejects already-paid, attempted, or amount-mismatched existing Razorpay orders without overwriting', async () => {
      seedBaselineCatalog(mockDbState);
      mockDbState.seedDoc('cardDesigns', 'des_conflict', {
        designId: 'des_conflict',
        uid: 'user_1',
        orderId: 'ord_existing_paid',
        locked: true,
        templateId: 'minimal-white',
        cardTechnology: 'qr_only', // 68800 paise
      });
      mockDbState.seedDoc('orders', 'ord_existing_paid', {
        orderId: 'ord_existing_paid',
        uid: 'user_1',
        designId: 'des_conflict',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
        razorpayOrderId: 'order_RzpAlreadyPaid1',
        razorpayAmountPaise: 68800,
      });

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'order_RzpAlreadyPaid1',
            amount: 68800,
            amount_paid: 68800,
            currency: 'INR',
            status: 'paid',
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_existing_paid' } })
      ).rejects.toMatchObject({ code: 'already-exists' });
      expect(mockDbState.readDoc('orders', 'ord_existing_paid')?.razorpayOrderId).toBe(
        'order_RzpAlreadyPaid1'
      );

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'order_RzpAlreadyPaid1',
            amount: 50000, // Mismatch vs 68800
            amount_paid: 0,
            currency: 'INR',
            status: 'created',
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_existing_paid' } })
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(mockDbState.readDoc('orders', 'ord_existing_paid')?.razorpayOrderId).toBe(
        'order_RzpAlreadyPaid1'
      );

      // Ambiguous attempted status must also fail closed and never create a replacement
      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'order_RzpAlreadyPaid1',
            amount: 68800,
            amount_paid: 0,
            currency: 'INR',
            status: 'attempted',
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_existing_paid' } })
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(mockDbState.readDoc('orders', 'ord_existing_paid')?.razorpayOrderId).toBe(
        'order_RzpAlreadyPaid1'
      );
    });

    it('prevents two simultaneous create-order requests from creating multiple Razorpay orders', async () => {
      seedBaselineCatalog(mockDbState);
      mockDbState.seedDoc('cardDesigns', 'des_race', {
        designId: 'des_race',
        uid: 'user_1',
        orderId: 'ord_race_1',
        locked: true,
        templateId: 'minimal-white',
        cardTechnology: 'qr_only',
      });
      mockDbState.seedDoc('orders', 'ord_race_1', {
        orderId: 'ord_race_1',
        uid: 'user_1',
        designId: 'des_race',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });

      let postCalls = 0;
      globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url.endsWith('/orders')) {
          postCalls += 1;
          await new Promise((r) => setTimeout(r, 25));
          return new Response(
            JSON.stringify({
              id: 'order_RzpConcurrent1',
              amount: 68800,
              currency: 'INR',
              status: 'created',
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected fetch call: ${init?.method} ${url}`);
      }) as unknown as typeof fetch;

      const settled = await Promise.allSettled([
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_race_1' } }),
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_race_1' } }),
      ]);

      const fulfilled = settled.filter(
        (s): s is PromiseFulfilledResult<Record<string, unknown>> => s.status === 'fulfilled'
      );
      const rejected = settled.filter(
        (s): s is PromiseRejectedResult => s.status === 'rejected'
      );

      expect(postCalls).toBe(1);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0].reason as { code?: string }).code).toBe('aborted');
      expect(fulfilled[0].value.gatewayOrderId).toBe('order_RzpConcurrent1');
      expect(mockDbState.readDoc('orders', 'ord_race_1')?.razorpayOrderId).toBe(
        'order_RzpConcurrent1'
      );
      expect(mockDbState.readDoc('orders', 'ord_race_1')?.razorpayOrderLock).toBeNull();
    });

    it('releases the creation lock safely on Razorpay API failure and fails closed on ambiguous states', async () => {
      seedBaselineCatalog(mockDbState);
      mockDbState.seedDoc('cardDesigns', 'des_retry', {
        designId: 'des_retry',
        uid: 'user_1',
        orderId: 'ord_retry_1',
        locked: true,
        templateId: 'minimal-white',
        cardTechnology: 'qr_only',
      });
      mockDbState.seedDoc('orders', 'ord_retry_1', {
        orderId: 'ord_retry_1',
        uid: 'user_1',
        designId: 'des_retry',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });

      // First attempt fails cleanly at Razorpay API (HTTP 502) -> lock must be released
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ error: { description: 'Gateway error' } }), { status: 502 })
      ) as unknown as typeof fetch;

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_retry_1' } })
      ).rejects.toMatchObject({ code: 'failed-precondition' });

      expect(mockDbState.readDoc('orders', 'ord_retry_1')?.razorpayOrderLock).toBeNull();
      expect(mockDbState.readDoc('orders', 'ord_retry_1')?.razorpayOrderId).toBeUndefined();

      // Subsequent retry succeeds cleanly after lock release
      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'order_RzpAfterRetry1',
            amount: 68800,
            currency: 'INR',
            status: 'created',
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      const recovered = await mod.createPaymentOrder({
        auth: { uid: 'user_1' },
        data: { orderId: 'ord_retry_1' },
      });
      expect(recovered.gatewayOrderId).toBe('order_RzpAfterRetry1');

      // Separate order: HTTP 200 with mismatched payload marks ambiguous & blocks replacement
      mockDbState.seedDoc('cardDesigns', 'des_ambig', {
        designId: 'des_ambig',
        uid: 'user_1',
        orderId: 'ord_ambig_1',
        locked: true,
        templateId: 'minimal-white',
        cardTechnology: 'qr_only',
      });
      mockDbState.seedDoc('orders', 'ord_ambig_1', {
        orderId: 'ord_ambig_1',
        uid: 'user_1',
        designId: 'des_ambig',
        quantity: 1,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'order_RzpBadAmount1',
            amount: 100, // wrong amount in 200 response -> ambiguous
            currency: 'INR',
            status: 'created',
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_ambig_1' } })
      ).rejects.toMatchObject({ code: 'failed-precondition' });

      const ambigLock = mockDbState.readDoc('orders', 'ord_ambig_1')?.razorpayOrderLock as {
        status?: string;
      };
      expect(ambigLock?.status).toBe('ambiguous');

      // Any follow-up attempt must fail closed without calling Razorpay API again
      const followUpFetch = vi.fn();
      globalThis.fetch = followUpFetch as unknown as typeof fetch;

      await expect(
        mod.createPaymentOrder({ auth: { uid: 'user_1' }, data: { orderId: 'ord_ambig_1' } })
      ).rejects.toThrow(/ambiguous/i);
      expect(followUpFetch).not.toHaveBeenCalled();
    });
  });

  describe('verifyPayment', () => {
    beforeEach(() => {
      mockDbState.seedDoc('profiles', 'prof_1', {
        profileId: 'prof_1',
        uid: 'user_1',
        slug: 'aarav-mehta',
        isPublic: false,
        paymentConfirmed: false,
        adminDisabled: false,
      });
      mockDbState.seedDoc('publicProfiles', 'aarav-mehta', {
        slug: 'aarav-mehta',
        isPublic: false,
        paymentConfirmed: false,
        adminDisabled: false,
      });
      mockDbState.seedDoc('orders', 'ord_verify_1', {
        orderId: 'ord_verify_1',
        uid: 'user_1',
        profileId: 'prof_1',
        profileSlug: 'aarav-mehta',
        currency: 'INR',
        total: 688,
        razorpayOrderId: 'order_RzpLive1001',
        razorpayAmountPaise: 68800,
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });
    });

    it('rejects wrong owner, synthetic IDs, order ID mismatch, and invalid or mismatched-length signatures', async () => {
      const validPayId = 'pay_RzpLive2001';
      const validSig = signPayment('order_RzpLive1001', validPayId);

      await expect(
        mod.verifyPayment({
          auth: { uid: 'other_user' },
          data: {
            orderId: 'ord_verify_1',
            gatewayOrderId: 'order_RzpLive1001',
            gatewayPaymentId: validPayId,
            signature: validSig,
          },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      await expect(
        mod.verifyPayment({
          auth: { uid: 'user_1' },
          data: {
            orderId: 'ord_verify_1',
            gatewayOrderId: 'order_rzp_sbx_1001',
            gatewayPaymentId: 'pay_sbx_2001',
            signature: validSig,
          },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      await expect(
        mod.verifyPayment({
          auth: { uid: 'user_1' },
          data: {
            orderId: 'ord_verify_1',
            gatewayOrderId: 'order_Different999',
            gatewayPaymentId: validPayId,
            signature: validSig,
          },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      // Short / invalid-length signature must fail cleanly without throwing RangeError
      await expect(
        mod.verifyPayment({
          auth: { uid: 'user_1' },
          data: {
            orderId: 'ord_verify_1',
            gatewayOrderId: 'order_RzpLive1001',
            gatewayPaymentId: validPayId,
            signature: 'short_bad_sig',
          },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('rejects uncaptured payments and Razorpay amount mismatches', async () => {
      const payId = 'pay_RzpAuthOnly1';
      const sig = signPayment('order_RzpLive1001', payId);

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: payId,
            order_id: 'order_RzpLive1001',
            amount: 68800,
            currency: 'INR',
            status: 'authorized', // NOT captured
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      await expect(
        mod.verifyPayment({
          auth: { uid: 'user_1' },
          data: {
            orderId: 'ord_verify_1',
            gatewayOrderId: 'order_RzpLive1001',
            gatewayPaymentId: payId,
            signature: sig,
          },
        })
      ).rejects.toThrow(/only captured payments/i);

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: payId,
            order_id: 'order_RzpLive1001',
            amount: 100, // Mismatched amount!
            currency: 'INR',
            status: 'captured',
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      await expect(
        mod.verifyPayment({
          auth: { uid: 'user_1' },
          data: {
            orderId: 'ord_verify_1',
            gatewayOrderId: 'order_RzpLive1001',
            gatewayPaymentId: payId,
            signature: sig,
          },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      expect(mockDbState.readDoc('orders', 'ord_verify_1')?.paymentStatus).toBe('Pending');
    });

    it('verifies captured payment atomically, supports idempotent retries, and blocks conflicting or reused payments', async () => {
      const payId = 'pay_RzpCaptured01';
      const sig = signPayment('order_RzpLive1001', payId);

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: payId,
            order_id: 'order_RzpLive1001',
            amount: 68800,
            currency: 'INR',
            status: 'captured',
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      const first = await mod.verifyPayment({
        auth: { uid: 'user_1' },
        data: {
          orderId: 'ord_verify_1',
          gatewayOrderId: 'order_RzpLive1001',
          gatewayPaymentId: payId,
          signature: sig,
        },
      });
      expect(first).toMatchObject({ verified: true, alreadyVerified: false, orderId: 'ord_verify_1' });
      expect(mockDbState.readDoc('orders', 'ord_verify_1')?.paymentStatus).toBe('Verified');
      expect(mockDbState.readDoc('orders', 'ord_verify_1')?.orderStatus).toBe('Payment Successful');
      expect(mockDbState.readDoc('payments', 'ord_verify_1')?.status).toBe('Verified');
      expect(mockDbState.readDoc('profiles', 'prof_1')?.paymentConfirmed).toBe(true);
      expect(mockDbState.readDoc('publicProfiles', 'aarav-mehta')?.paymentConfirmed).toBe(true);

      // Idempotent retry with same payment ID
      const second = await mod.verifyPayment({
        auth: { uid: 'user_1' },
        data: {
          orderId: 'ord_verify_1',
          gatewayOrderId: 'order_RzpLive1001',
          gatewayPaymentId: payId,
          signature: sig,
        },
      });
      expect(second).toMatchObject({ verified: true, alreadyVerified: true });

      // Conflicting different payment ID on same already-paid order
      const otherPayId = 'pay_RzpDifferent02';
      const otherSig = signPayment('order_RzpLive1001', otherPayId);
      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: otherPayId,
            order_id: 'order_RzpLive1001',
            amount: 68800,
            currency: 'INR',
            status: 'captured',
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      await expect(
        mod.verifyPayment({
          auth: { uid: 'user_1' },
          data: {
            orderId: 'ord_verify_1',
            gatewayOrderId: 'order_RzpLive1001',
            gatewayPaymentId: otherPayId,
            signature: otherSig,
          },
        })
      ).rejects.toMatchObject({ code: 'already-exists' });

      // Reusing pay_RzpCaptured01 on a second order must also fail
      mockDbState.seedDoc('orders', 'ord_verify_2', {
        orderId: 'ord_verify_2',
        uid: 'user_1',
        currency: 'INR',
        total: 688,
        razorpayOrderId: 'order_RzpLive1002',
        razorpayAmountPaise: 68800,
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });
      const reusedSig = signPayment('order_RzpLive1002', payId);
      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: payId,
            order_id: 'order_RzpLive1002',
            amount: 68800,
            currency: 'INR',
            status: 'captured',
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      await expect(
        mod.verifyPayment({
          auth: { uid: 'user_1' },
          data: {
            orderId: 'ord_verify_2',
            gatewayOrderId: 'order_RzpLive1002',
            gatewayPaymentId: payId,
            signature: reusedSig,
          },
        })
      ).rejects.toMatchObject({ code: 'already-exists' });
    });
  });

  describe('razorpayWebhook', () => {
    beforeEach(() => {
      mockDbState.seedDoc('orders', 'ord_wh_1', {
        orderId: 'ord_wh_1',
        uid: 'user_1',
        currency: 'INR',
        total: 1511,
        razorpayOrderId: 'order_RzpWh5001',
        razorpayAmountPaise: 151100,
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });
    });

    it('rejects invalid signatures cleanly without throwing and requires x-razorpay-event-id', async () => {
      const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: {} }));

      const badRes = createMockRes();
      await mod.razorpayWebhook(
        {
          method: 'POST',
          headers: { 'x-razorpay-signature': 'bad_short', 'x-razorpay-event-id': 'evt_1' },
          rawBody: body,
        },
        badRes
      );
      expect(badRes.getStatus()).toBe(401);

      const missingEvtRes = createMockRes();
      await mod.razorpayWebhook(
        {
          method: 'POST',
          headers: { 'x-razorpay-signature': signWebhook(body) },
          rawBody: body,
        },
        missingEvtRes
      );
      expect(missingEvtRes.getStatus()).toBe(400);
    });

    it('does not mark order paid for uncaptured payment.authorized webhook', async () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'payment.authorized',
          payload: {
            payment: {
              entity: {
                id: 'pay_WhAuth1',
                order_id: 'order_RzpWh5001',
                amount: 151100,
                currency: 'INR',
                status: 'authorized',
              },
            },
          },
        })
      );

      const res = createMockRes();
      await mod.razorpayWebhook(
        {
          method: 'POST',
          headers: {
            'x-razorpay-signature': signWebhook(rawBody),
            'x-razorpay-event-id': 'evt_auth_only_1',
          },
          rawBody,
        },
        res
      );

      expect(res.getStatus()).toBe(200);
      expect(mockDbState.readDoc('orders', 'ord_wh_1')?.paymentStatus).toBe('Pending');
      expect(mockDbState.readDoc('razorpayWebhookEvents', 'evt_auth_only_1')?.status).toBe(
        'ignored_event_type'
      );
    });

    it('verifies payment.captured, deduplicates repeated event IDs, and never reverts verified orders on out-of-order payment.failed', async () => {
      const capturedBody = Buffer.from(
        JSON.stringify({
          event: 'payment.captured',
          payload: {
            payment: {
              entity: {
                id: 'pay_WhCaptured5001',
                order_id: 'order_RzpWh5001',
                amount: 151100,
                currency: 'INR',
                status: 'captured',
              },
            },
          },
        })
      );

      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'pay_WhCaptured5001',
            order_id: 'order_RzpWh5001',
            amount: 151100,
            currency: 'INR',
            status: 'captured',
          }),
          { status: 200 }
        )
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const res1 = createMockRes();
      await mod.razorpayWebhook(
        {
          method: 'POST',
          headers: {
            'x-razorpay-signature': signWebhook(capturedBody),
            'x-razorpay-event-id': 'evt_cap_5001',
          },
          rawBody: capturedBody,
        },
        res1
      );
      expect(res1.getStatus()).toBe(200);
      expect(mockDbState.readDoc('orders', 'ord_wh_1')?.paymentStatus).toBe('Verified');
      expect(mockDbState.readDoc('orders', 'ord_wh_1')?.orderStatus).toBe('Payment Successful');
      expect(mockDbState.readDoc('payments', 'ord_wh_1')?.status).toBe('Verified');
      expect(mockDbState.readDoc('razorpayWebhookEvents', 'evt_cap_5001')?.status).toBe('processed_paid');

      // Duplicate delivery with same x-razorpay-event-id should short-circuit without calling Razorpay API again
      const resDup = createMockRes();
      await mod.razorpayWebhook(
        {
          method: 'POST',
          headers: {
            'x-razorpay-signature': signWebhook(capturedBody),
            'x-razorpay-event-id': 'evt_cap_5001',
          },
          rawBody: capturedBody,
        },
        resDup
      );
      expect(resDup.getStatus()).toBe(200);
      expect(resDup.getBody()).toMatchObject({ received: true, duplicate: true, eventId: 'evt_cap_5001' });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Simulate fulfillment progressing, then an out-of-order payment.failed event arrives
      mockDbState.seedDoc('orders', 'ord_wh_1', {
        ...mockDbState.readDoc('orders', 'ord_wh_1')!,
        orderStatus: 'Assigned to Printer',
      });

      const failedBody = Buffer.from(
        JSON.stringify({
          event: 'payment.failed',
          payload: {
            payment: {
              entity: {
                id: 'pay_WhOldFail001',
                order_id: 'order_RzpWh5001',
                status: 'failed',
                error_description: 'Delayed failure webhook from earlier attempt',
              },
            },
          },
        })
      );

      const resFail = createMockRes();
      await mod.razorpayWebhook(
        {
          method: 'POST',
          headers: {
            'x-razorpay-signature': signWebhook(failedBody),
            'x-razorpay-event-id': 'evt_fail_late_1',
          },
          rawBody: failedBody,
        },
        resFail
      );
      expect(resFail.getStatus()).toBe(200);
      expect(mockDbState.readDoc('orders', 'ord_wh_1')?.paymentStatus).toBe('Verified');
      expect(mockDbState.readDoc('orders', 'ord_wh_1')?.orderStatus).toBe('Assigned to Printer');
      expect(mockDbState.readDoc('payments', 'ord_wh_1')?.status).toBe('Verified');
      expect(mockDbState.readDoc('razorpayWebhookEvents', 'evt_fail_late_1')?.status).toBe(
        'ignored_already_paid_out_of_order'
      );
    });

    it('rejects webhook amount mismatch and records valid payment.failed on pending orders without losing Awaiting Payment', async () => {
      const mismatchBody = Buffer.from(
        JSON.stringify({
          event: 'order.paid',
          payload: {
            payment: {
              entity: {
                id: 'pay_WhShortPaid1',
                order_id: 'order_RzpWh5001',
                amount: 100,
                currency: 'INR',
                status: 'captured',
              },
            },
            order: {
              entity: {
                id: 'order_RzpWh5001',
                status: 'paid',
              },
            },
          },
        })
      );

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'pay_WhShortPaid1',
            order_id: 'order_RzpWh5001',
            amount: 100, // less than 151100 paise
            currency: 'INR',
            status: 'captured',
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      const mismatchRes = createMockRes();
      await mod.razorpayWebhook(
        {
          method: 'POST',
          headers: {
            'x-razorpay-signature': signWebhook(mismatchBody),
            'x-razorpay-event-id': 'evt_mismatch_1',
          },
          rawBody: mismatchBody,
        },
        mismatchRes
      );
      expect(mismatchRes.getStatus()).toBe(400);
      expect(mockDbState.readDoc('orders', 'ord_wh_1')?.paymentStatus).toBe('Pending');
      expect(mockDbState.readDoc('razorpayWebhookEvents', 'evt_mismatch_1')?.status).toBe(
        'rejected_amount_mismatch'
      );

      const pendingFailedBody = Buffer.from(
        JSON.stringify({
          event: 'payment.failed',
          payload: {
            payment: {
              entity: {
                id: 'pay_WhDeclined1',
                order_id: 'order_RzpWh5001',
                status: 'failed',
                error_description: 'Bank declined UPI collect',
              },
            },
          },
        })
      );

      const failRes = createMockRes();
      await mod.razorpayWebhook(
        {
          method: 'POST',
          headers: {
            'x-razorpay-signature': signWebhook(pendingFailedBody),
            'x-razorpay-event-id': 'evt_pending_fail_1',
          },
          rawBody: pendingFailedBody,
        },
        failRes
      );
      expect(failRes.getStatus()).toBe(200);
      expect(mockDbState.readDoc('orders', 'ord_wh_1')?.paymentStatus).toBe('Failed');
      expect(mockDbState.readDoc('orders', 'ord_wh_1')?.orderStatus).toBe('Awaiting Payment');
      expect(mockDbState.readDoc('payments', 'ord_wh_1')?.status).toBe('Failed');
      expect(mockDbState.readDoc('razorpayWebhookEvents', 'evt_pending_fail_1')?.status).toBe(
        'processed_failed'
      );
    });
  });

  describe('Phase 2B: generatePurchasedQr hardening', () => {
    it('rejects unauthenticated callers, non-owners, and unverified orders', async () => {
      mockDbState.seedDoc('orders', 'ord_qr_unverified', {
        orderId: 'ord_qr_unverified',
        uid: 'user_owner',
        profileId: 'prof_qr_1',
        profileSlug: 'owner-slug',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });

      await expect(
        mod.generatePurchasedQr({ auth: null, data: { orderId: 'ord_qr_unverified' } })
      ).rejects.toMatchObject({ code: 'unauthenticated' });

      await expect(
        mod.generatePurchasedQr({
          auth: { uid: 'attacker_uid' },
          data: { orderId: 'ord_qr_unverified' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      await expect(
        mod.generatePurchasedQr({
          auth: { uid: 'user_owner' },
          data: { orderId: 'ord_qr_unverified' },
        })
      ).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('rejects shop orders without a valid linked profileSlug and never generates /p/undefined', async () => {
      mockDbState.seedDoc('orders', 'ord_shop_nolink', {
        orderId: 'ord_shop_nolink',
        uid: 'user_1',
        profileId: 'shop_cart',
        profileSlug: '',
        designId: 'shop_direct',
        orderSource: 'shop',
        paymentStatus: 'Verified',
        orderStatus: 'Payment Successful',
      });

      await expect(
        mod.generatePurchasedQr({
          auth: { uid: 'user_1' },
          data: { orderId: 'ord_shop_nolink' },
        })
      ).rejects.toMatchObject({ code: 'failed-precondition' });

      expect(mockDbState.readDoc('qrCodes', 'ord_shop_nolink')).toBeUndefined();
    });

    it('generates QR atomically for verified orders with valid slug and supports idempotent retries', async () => {
      mockDbState.seedDoc('profiles', 'prof_studio_1', {
        profileId: 'prof_studio_1',
        uid: 'user_1',
        slug: 'rohan-kapoor',
      });
      mockDbState.seedDoc('orders', 'ord_qr_ok', {
        orderId: 'ord_qr_ok',
        uid: 'user_1',
        profileId: 'prof_studio_1',
        profileSlug: 'rohan-kapoor',
        printerId: 'printer_1',
        paymentStatus: 'Verified',
        orderStatus: 'Payment Successful',
        qrCodeId: '',
      });

      const first = await mod.generatePurchasedQr({
        auth: { uid: 'user_1' },
        data: { orderId: 'ord_qr_ok' },
      });

      expect(first).toMatchObject({
        qrCodeId: 'ord_qr_ok',
        alreadyExists: false,
      });
      expect(String(first.targetUrl)).toMatch(/\/p\/rohan-kapoor$/);

      const savedQr = mockDbState.readDoc('qrCodes', 'ord_qr_ok');
      expect(savedQr?.orderId).toBe('ord_qr_ok');
      expect(savedQr?.qrType).toBe('CUSTOMER_ORDER');
      expect(String(savedQr?.pngDataUrl || '')).toMatch(/^data:image\/png;base64,/);

      const savedOrder = mockDbState.readDoc('orders', 'ord_qr_ok');
      expect(savedOrder?.qrCodeId).toBe('ord_qr_ok');
      expect(savedOrder?.printFileReady).toBe(true);

      const second = await mod.generatePurchasedQr({
        auth: { uid: 'user_1' },
        data: { orderId: 'ord_qr_ok' },
      });
      expect(second).toMatchObject({
        qrCodeId: 'ord_qr_ok',
        targetUrl: first.targetUrl,
        alreadyExists: true,
      });
    });
  });

  describe('Phase 2B Security Repair: server-only admin payment reconciliation, QR & print dispatch', () => {
    beforeEach(() => {
      seedBaselineCatalog(mockDbState);
      mockDbState.seedDoc('users', 'admin_1', {
        uid: 'admin_1',
        email: 'admin@tapnex.in',
        role: 'ADMIN',
        status: 'Active',
      });
      mockDbState.seedDoc('admins', 'admin_1', {
        uid: 'admin_1',
        role: 'ADMIN',
        active: true,
      });
      mockDbState.seedDoc('users', 'super_1', {
        uid: 'super_1',
        email: 'super@tapnex.in',
        role: 'SUPERADMIN',
        status: 'Active',
      });
      mockDbState.seedDoc('admins', 'super_1', {
        uid: 'super_1',
        role: 'SUPERADMIN',
        active: true,
      });
      mockDbState.seedDoc('users', 'printer_1', {
        uid: 'printer_1',
        email: 'printer@tapnex.in',
        role: 'PRINTER',
        status: 'Active',
      });
      mockDbState.seedDoc('printers', 'printer_1', {
        printerId: 'printer_1',
        uid: 'printer_1',
        companyName: 'TapNex Press',
        status: 'Active',
      });
    });

    it('adminReconcileOrderPayment enforces admin role + explicit reason and atomically syncs order, payment, profile, publicProfile, and audit log', async () => {
      mockDbState.seedDoc('profiles', 'prof_rec_1', {
        profileId: 'prof_rec_1',
        uid: 'user_1',
        slug: 'reconcile-slug',
        isPublic: false,
        paymentConfirmed: false,
      });
      mockDbState.seedDoc('publicProfiles', 'reconcile-slug', {
        profileId: 'prof_rec_1',
        uid: 'user_1',
        slug: 'reconcile-slug',
        isPublic: false,
        paymentConfirmed: false,
      });
      mockDbState.seedDoc('orders', 'ord_rec_1', {
        orderId: 'ord_rec_1',
        orderNumber: 'TNX-2026-REC1',
        uid: 'user_1',
        profileId: 'prof_rec_1',
        profileSlug: 'reconcile-slug',
        total: 1277.82,
        currency: 'INR',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });

      await expect(
        mod.adminReconcileOrderPayment({
          auth: null,
          data: { orderId: 'ord_rec_1', paymentStatus: 'Verified', reason: 'Bank UTR settled' },
        })
      ).rejects.toMatchObject({ code: 'unauthenticated' });

      await expect(
        mod.adminReconcileOrderPayment({
          auth: { uid: 'user_1' },
          data: { orderId: 'ord_rec_1', paymentStatus: 'Verified', reason: 'Self mark paid' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      await expect(
        mod.adminReconcileOrderPayment({
          auth: { uid: 'printer_1' },
          data: { orderId: 'ord_rec_1', paymentStatus: 'Verified', reason: 'Printer override' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      await expect(
        mod.adminReconcileOrderPayment({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: { orderId: 'ord_rec_1', paymentStatus: 'Verified', reason: 'no' },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      const result = await mod.adminReconcileOrderPayment({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: {
          orderId: 'ord_rec_1',
          paymentStatus: 'Verified',
          reason: 'NEFT settlement verified against Razorpay dashboard',
          gatewayReference: 'pay_manual_ref_123',
        },
      });

      expect(result).toEqual({
        orderId: 'ord_rec_1',
        paymentStatus: 'Verified',
        orderStatus: 'Payment Successful',
      });
      expect(mockDbState.readDoc('orders', 'ord_rec_1')).toMatchObject({
        paymentStatus: 'Verified',
        orderStatus: 'Payment Successful',
      });
      expect(mockDbState.readDoc('payments', 'ord_rec_1')).toMatchObject({
        status: 'Verified',
        verifiedVia: 'adminReconciliation',
        reconciledByUid: 'admin_1',
        reconciledByEmail: 'admin@tapnex.in',
        gatewayOrderId: 'pay_manual_ref_123',
      });
      expect(mockDbState.readDoc('profiles', 'prof_rec_1')).toMatchObject({
        paymentConfirmed: true,
        isPublic: true,
      });
      expect(mockDbState.readDoc('publicProfiles', 'reconcile-slug')).toMatchObject({
        paymentConfirmed: true,
        isPublic: true,
        lastPaidOrderId: 'ord_rec_1',
      });

      const logs = Array.from(mockDbState.store.get('auditLogs')?.values() || []);
      expect(logs.some((l) => l.action === 'ADMIN_RECONCILE_ORDER_PAYMENT' && l.targetId === 'ord_rec_1')).toBe(
        true
      );
    });

    it('adminReconcileProfilePayment enforces admin role and syncs profile + publicProfile + audit log', async () => {
      mockDbState.seedDoc('profiles', 'prof_unlock_1', {
        profileId: 'prof_unlock_1',
        uid: 'user_1',
        slug: 'unlock-slug',
        isPublic: false,
        paymentConfirmed: false,
      });
      mockDbState.seedDoc('publicProfiles', 'unlock-slug', {
        profileId: 'prof_unlock_1',
        uid: 'user_1',
        slug: 'unlock-slug',
        isPublic: false,
        paymentConfirmed: false,
      });

      await expect(
        mod.adminReconcileProfilePayment({
          auth: { uid: 'user_1' },
          data: { profileId: 'prof_unlock_1', completed: true },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      const res = await mod.adminReconcileProfilePayment({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: {
          profileId: 'prof_unlock_1',
          completed: true,
          reference: 'INV-8821',
          reason: 'Offline invoice settled',
        },
      });

      expect(res).toMatchObject({
        profileId: 'prof_unlock_1',
        slug: 'unlock-slug',
        paymentConfirmed: true,
        paymentReference: 'INV-8821',
        isPublic: true,
      });
      expect(mockDbState.readDoc('profiles', 'prof_unlock_1')?.paymentConfirmed).toBe(true);
      expect(mockDbState.readDoc('publicProfiles', 'unlock-slug')?.paymentConfirmed).toBe(true);
    });

    it('adminEnsureOrderQr rejects unpaid orders and idempotently prepares CUSTOMER_ORDER QR for paid orders', async () => {
      mockDbState.seedDoc('orders', 'ord_admin_qr_unpaid', {
        orderId: 'ord_admin_qr_unpaid',
        uid: 'user_1',
        profileId: 'prof_1',
        profileSlug: 'rohan-kapoor',
        paymentStatus: 'Pending',
        orderStatus: 'Awaiting Payment',
      });

      await expect(
        mod.adminEnsureOrderQr({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: { orderId: 'ord_admin_qr_unpaid' },
        })
      ).rejects.toMatchObject({ code: 'failed-precondition' });

      mockDbState.seedDoc('orders', 'ord_admin_qr_paid', {
        orderId: 'ord_admin_qr_paid',
        orderNumber: 'TNX-2026-QR99',
        uid: 'user_1',
        profileId: 'prof_1',
        profileSlug: 'rohan-kapoor',
        printerId: 'printer_1',
        paymentStatus: 'Verified',
        orderStatus: 'Payment Successful',
      });

      const first = await mod.adminEnsureOrderQr({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: { orderId: 'ord_admin_qr_paid' },
      });
      expect(first).toMatchObject({
        qrCodeId: 'ord_admin_qr_paid',
        qrType: 'CUSTOMER_ORDER',
        alreadyExists: false,
      });
      expect(mockDbState.readDoc('orders', 'ord_admin_qr_paid')).toMatchObject({
        qrCodeId: 'ord_admin_qr_paid',
        printFileReady: true,
      });
      expect(mockDbState.readDoc('qrCodes', 'ord_admin_qr_paid')?.qrType).toBe('CUSTOMER_ORDER');

      const second = await mod.adminEnsureOrderQr({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: { orderId: 'ord_admin_qr_paid' },
      });
      expect(second.alreadyExists).toBe(true);
    });

    it('adminSendDesignToPrint rejects markPaymentCompleted and unpaid non-complimentary runs, supports verified paid orders and audited complimentary runs', async () => {
      mockDbState.seedDoc('profiles', 'prof_print_1', {
        profileId: 'prof_print_1',
        uid: 'user_1',
        slug: 'print-user-slug',
        isPublic: false,
        paymentConfirmed: false,
      });
      mockDbState.seedDoc('publicProfiles', 'print-user-slug', {
        profileId: 'prof_print_1',
        uid: 'user_1',
        slug: 'print-user-slug',
        isPublic: false,
        paymentConfirmed: false,
      });
      mockDbState.seedDoc('cardDesigns', 'des_unapproved', {
        designId: 'des_unapproved',
        uid: 'user_1',
        profileId: 'prof_print_1',
        templateId: 'minimal-white',
        cardTechnology: 'qr_smart',
        approved: false,
      });
      mockDbState.seedDoc('cardDesigns', 'des_approved', {
        designId: 'des_approved',
        uid: 'user_1',
        profileId: 'prof_print_1',
        templateId: 'minimal-white',
        cardTechnology: 'qr_smart',
        approved: true,
      });

      const baseShipping = {
        fullName: 'Rohan',
        mobile: '9876543210',
        email: 'r@tapnex.in',
        addressLine1: 'MG Road',
        city: 'Pune',
        pinCode: '411001',
      };

      // 1. Customer denied
      await expect(
        mod.adminSendDesignToPrint({
          auth: { uid: 'user_1' },
          data: {
            designId: 'des_approved',
            printerId: 'printer_1',
            quantity: 2,
            complimentary: true,
            complimentaryReason: 'VIP sample',
            shippingAddress: baseShipping,
          },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      // 2. Unapproved design denied
      await expect(
        mod.adminSendDesignToPrint({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: {
            designId: 'des_unapproved',
            printerId: 'printer_1',
            quantity: 2,
            complimentary: true,
            complimentaryReason: 'VIP sample',
            shippingAddress: baseShipping,
          },
        })
      ).rejects.toMatchObject({ code: 'failed-precondition' });

      // 3. Legacy markPaymentCompleted cannot mark an unpaid order paid
      await expect(
        mod.adminSendDesignToPrint({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: {
            designId: 'des_approved',
            printerId: 'printer_1',
            quantity: 2,
            markPaymentCompleted: true,
            shippingAddress: baseShipping,
          },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      // 4. Unpaid print job without explicit complimentary flag fails
      await expect(
        mod.adminSendDesignToPrint({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: {
            designId: 'des_approved',
            printerId: 'printer_1',
            quantity: 2,
            shippingAddress: baseShipping,
          },
        })
      ).rejects.toMatchObject({ code: 'failed-precondition' });

      // 5. Complimentary job without valid reason fails
      await expect(
        mod.adminSendDesignToPrint({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: {
            designId: 'des_approved',
            printerId: 'printer_1',
            quantity: 2,
            complimentary: true,
            complimentaryReason: 'no',
            shippingAddress: baseShipping,
          },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      // 6. Valid complimentary print job stays Pending, uses ADMIN_CUSTOM QR, writes no /payments doc, leaves profile unpaid, and logs audit
      const compRes = await mod.adminSendDesignToPrint({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: {
          designId: 'des_approved',
          printerId: 'printer_1',
          initialOrderStatus: 'Assigned to Printer',
          quantity: 2,
          complimentary: true,
          complimentaryReason: 'Founder approved VIP event sample',
          shippingAddress: baseShipping,
        },
      });

      const compOrderId = String(compRes.orderId);
      const savedCompOrder = mockDbState.readDoc('orders', compOrderId);
      // Authoritative pricing: minimal qr_smart (999) * 2 = 1998 subtotal, 18% GST = 360, shipping = 99 => total 2457
      expect(savedCompOrder).toMatchObject({
        uid: 'user_1',
        designId: 'des_approved',
        printerId: 'printer_1',
        quantity: 2,
        subtotal: 1998,
        tax: 360,
        shipping: 99,
        total: 2457,
        paymentStatus: 'Pending',
        complimentary: true,
        complimentaryReason: 'Founder approved VIP event sample',
        orderStatus: 'Assigned to Printer',
        printFileReady: true,
      });
      expect(String(savedCompOrder?.internalNotes || '')).toContain('Founder approved VIP event sample');
      expect(mockDbState.readDoc('cardDesigns', 'des_approved')).toMatchObject({
        locked: true,
        orderId: compOrderId,
      });
      expect(mockDbState.readDoc('qrCodes', compOrderId)).toMatchObject({
        qrType: 'ADMIN_CUSTOM',
        printerId: 'printer_1',
      });
      expect(mockDbState.readDoc('payments', compOrderId)).toBeUndefined();
      expect(mockDbState.readDoc('profiles', 'prof_print_1')?.paymentConfirmed).toBe(false);
      expect(mockDbState.readDoc('publicProfiles', 'print-user-slug')?.paymentConfirmed).toBe(false);

      const compAuditLogs = Array.from(mockDbState.store.get('auditLogs')?.values() || []);
      expect(
        compAuditLogs.some(
          (l) =>
            l.action === 'SEND_COMPLIMENTARY_PRINT' &&
            l.targetId === compOrderId &&
            String(l.details || '').includes('Founder approved VIP event sample')
        )
      ).toBe(true);

      // 7. Printing an already verified paid order preserves verified payment and creates CUSTOMER_ORDER QR
      mockDbState.seedDoc('cardDesigns', 'des_paid_1', {
        designId: 'des_paid_1',
        uid: 'user_1',
        profileId: 'prof_print_1',
        templateId: 'minimal-white',
        cardTechnology: 'qr_smart',
        approved: true,
        locked: true,
        orderId: 'ord_paid_print_1',
      });
      mockDbState.seedDoc('orders', 'ord_paid_print_1', {
        orderId: 'ord_paid_print_1',
        orderNumber: 'TNX-2026-PAID1',
        uid: 'user_1',
        profileId: 'prof_print_1',
        profileSlug: 'print-user-slug',
        designId: 'des_paid_1',
        quantity: 1,
        subtotal: 999,
        tax: 180,
        shipping: 99,
        total: 1278,
        currency: 'INR',
        paymentStatus: 'Verified',
        orderStatus: 'Payment Successful',
      });

      await expect(
        mod.adminSendDesignToPrint({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: {
            designId: 'des_paid_1',
            orderId: 'ord_paid_print_1',
            printerId: 'printer_1',
            quantity: 1,
            complimentary: true,
            complimentaryReason: 'Should reject on paid order',
            shippingAddress: baseShipping,
          },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      const paidRes = await mod.adminSendDesignToPrint({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: {
          designId: 'des_paid_1',
          orderId: 'ord_paid_print_1',
          printerId: 'printer_1',
          initialOrderStatus: 'Assigned to Printer',
          quantity: 1,
          shippingAddress: baseShipping,
        },
      });
      expect(paidRes).toMatchObject({
        orderId: 'ord_paid_print_1',
        complimentary: false,
        paymentStatus: 'Verified',
      });
      expect(mockDbState.readDoc('qrCodes', 'ord_paid_print_1')?.qrType).toBe('CUSTOMER_ORDER');
      expect(mockDbState.readDoc('orders', 'ord_paid_print_1')?.paymentStatus).toBe('Verified');
    });

    it('assertRole blocks inactive admin, invalid admin role, unverified admin, and Pending Verification while preserving missing-admin legacy fallback', async () => {
      mockDbState.seedDoc('profiles', 'prof_role_test', {
        profileId: 'prof_role_test',
        uid: 'user_1',
        slug: 'role-test-slug',
        isPublic: false,
        paymentConfirmed: false,
      });

      // 1. Inactive admins/{uid} must be rejected WITHOUT falling back to users/{uid}.role
      mockDbState.seedDoc('users', 'admin_inactive', {
        uid: 'admin_inactive',
        email: 'inactive@tapnex.in',
        role: 'SUPERADMIN',
        status: 'Active',
      });
      mockDbState.seedDoc('admins', 'admin_inactive', {
        uid: 'admin_inactive',
        role: 'SUPERADMIN',
        active: false,
      });
      await expect(
        mod.adminReconcileProfilePayment({
          auth: { uid: 'admin_inactive', token: { email: 'inactive@tapnex.in', email_verified: true } },
          data: { profileId: 'prof_role_test', completed: true, reason: 'Inactive admin test' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      // 2. Invalid admins/{uid}.role must be rejected WITHOUT falling back to users/{uid}.role
      mockDbState.seedDoc('users', 'admin_invalid_role', {
        uid: 'admin_invalid_role',
        email: 'invalid@tapnex.in',
        role: 'ADMIN',
        status: 'Active',
      });
      mockDbState.seedDoc('admins', 'admin_invalid_role', {
        uid: 'admin_invalid_role',
        role: 'USER',
        active: true,
      });
      await expect(
        mod.adminReconcileProfilePayment({
          auth: { uid: 'admin_invalid_role', token: { email: 'invalid@tapnex.in', email_verified: true } },
          data: { profileId: 'prof_role_test', completed: true, reason: 'Invalid admin role test' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      // 3. Unverified administrator email must be rejected
      await expect(
        mod.adminReconcileProfilePayment({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: false } },
          data: { profileId: 'prof_role_test', completed: true, reason: 'Unverified email check' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      // 4. Pending Verification account must be rejected on privileged operations
      mockDbState.seedDoc('users', 'admin_pending', {
        uid: 'admin_pending',
        email: 'pending@tapnex.in',
        role: 'ADMIN',
        status: 'Pending Verification',
      });
      mockDbState.seedDoc('admins', 'admin_pending', {
        uid: 'admin_pending',
        role: 'ADMIN',
        active: true,
      });
      await expect(
        mod.adminReconcileProfilePayment({
          auth: { uid: 'admin_pending', token: { email: 'pending@tapnex.in', email_verified: true } },
          data: { profileId: 'prof_role_test', completed: true, reason: 'Pending user status check' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      // 5. Missing admins/{uid} genuinely preserves legacy users.role fallback (when Active and email_verified)
      mockDbState.seedDoc('users', 'legacy_admin', {
        uid: 'legacy_admin',
        email: 'legacy@tapnex.in',
        role: 'ADMIN',
        status: 'Active',
      });
      const legacyRes = await mod.adminReconcileProfilePayment({
        auth: { uid: 'legacy_admin', token: { email: 'legacy@tapnex.in', email_verified: true } },
        data: { profileId: 'prof_role_test', completed: true, reason: 'Legacy admin fallback verified' },
      });
      expect(legacyRes.paymentConfirmed).toBe(true);
    });

    it('generateAdminQr validates URLs, assignPrinter syncs QR + validates active printers, and updateOrderStatus blocks payment statuses', async () => {
      await expect(
        mod.generateAdminQr({
          auth: { uid: 'super_1', token: { email: 'super@tapnex.in', email_verified: true } },
          data: { targetUrl: 'javascript:alert(1)' },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      const adminQr = await mod.generateAdminQr({
        auth: { uid: 'super_1', token: { email: 'super@tapnex.in', email_verified: true } },
        data: { targetUrl: 'https://tapnex.in/p/custom-vip', customerName: 'VIP Guest' },
      });
      expect(adminQr).toMatchObject({
        qrType: 'ADMIN_CUSTOM',
        targetUrl: 'https://tapnex.in/p/custom-vip',
        customerName: 'VIP Guest',
      });

      mockDbState.seedDoc('orders', 'ord_assign_1', {
        orderId: 'ord_assign_1',
        uid: 'user_1',
        printerId: '',
        orderStatus: 'Payment Successful',
      });
      mockDbState.seedDoc('qrCodes', 'ord_assign_1', {
        qrCodeId: 'ord_assign_1',
        orderId: 'ord_assign_1',
        printerId: '',
      });

      await expect(
        mod.assignPrinter({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: { orderId: 'ord_assign_1', printerId: 'nonexistent_printer' },
        })
      ).rejects.toMatchObject({ code: 'failed-precondition' });

      await mod.assignPrinter({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: { orderId: 'ord_assign_1', printerId: 'printer_1' },
      });
      expect(mockDbState.readDoc('orders', 'ord_assign_1')).toMatchObject({
        printerId: 'printer_1',
        orderStatus: 'Assigned to Printer',
      });
      expect(mockDbState.readDoc('qrCodes', 'ord_assign_1')?.printerId).toBe('printer_1');

      await expect(
        mod.updateOrderStatus({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: { orderId: 'ord_assign_1', orderStatus: 'Payment Successful' },
        })
      ).rejects.toMatchObject({ code: 'failed-precondition' });

      await expect(
        mod.updateOrderStatus({
          auth: { uid: 'printer_1', token: { email: 'printer@tapnex.in' } },
          data: { orderId: 'ord_assign_1', orderStatus: 'Cancelled' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      await mod.updateOrderStatus({
        auth: { uid: 'printer_1', token: { email: 'printer@tapnex.in' } },
        data: { orderId: 'ord_assign_1', orderStatus: 'Printing in Progress' },
      });
      expect(mockDbState.readDoc('orders', 'ord_assign_1')?.orderStatus).toBe('Printing in Progress');
    });
  });

  describe('Phase 2C: Secure dispatchDocs upload, authenticated HTTP streaming download, and delete', () => {
    const samplePdfBytes = Buffer.from('%PDF-1.4\nTapNex Dispatch Manifest\n');
    const samplePdfB64 = samplePdfBytes.toString('base64');
    const samplePngBytes = Buffer.from('fakepngbytes1234');
    const samplePngB64 = samplePngBytes.toString('base64');

    const adminToken = makeTestIdToken({
      uid: 'admin_1',
      email: 'admin@tapnex.in',
      email_verified: true,
    });
    const superAdminToken = makeTestIdToken({
      uid: 'superadmin_1',
      email: 'super@tapnex.in',
      email_verified: true,
    });
    const unverifiedAdminToken = makeTestIdToken({
      uid: 'admin_1',
      email: 'admin@tapnex.in',
      email_verified: false,
    });
    const printer1Token = makeTestIdToken({
      uid: 'printer_1',
      email: 'printer@tapnex.in',
      email_verified: true,
    });
    const printer2Token = makeTestIdToken({
      uid: 'printer_2',
      email: 'printer2@tapnex.in',
      email_verified: true,
    });
    const inactivePrinterToken = makeTestIdToken({
      uid: 'printer_inactive',
      email: 'inactive-printer@tapnex.in',
      email_verified: true,
    });
    const customerToken = makeTestIdToken({
      uid: 'user_1',
      email: 'user1@tapnex.in',
      email_verified: true,
    });

    beforeEach(() => {
      seedBaselineCatalog(mockDbState);
      mockDbState.seedDoc('users', 'admin_1', {
        uid: 'admin_1',
        email: 'admin@tapnex.in',
        role: 'ADMIN',
        status: 'Active',
      });
      mockDbState.seedDoc('admins', 'admin_1', {
        uid: 'admin_1',
        role: 'ADMIN',
        active: true,
      });
      mockDbState.seedDoc('users', 'superadmin_1', {
        uid: 'superadmin_1',
        email: 'super@tapnex.in',
        role: 'SUPERADMIN',
        status: 'Active',
      });
      mockDbState.seedDoc('admins', 'superadmin_1', {
        uid: 'superadmin_1',
        role: 'SUPERADMIN',
        active: true,
      });
      mockDbState.seedDoc('users', 'printer_1', {
        uid: 'printer_1',
        email: 'printer@tapnex.in',
        role: 'PRINTER',
        status: 'Active',
      });
      mockDbState.seedDoc('printers', 'printer_1', {
        printerId: 'printer_1',
        uid: 'printer_1',
        companyName: 'TapNex Press 1',
        status: 'Active',
      });
      mockDbState.seedDoc('users', 'printer_2', {
        uid: 'printer_2',
        email: 'printer2@tapnex.in',
        role: 'PRINTER',
        status: 'Active',
      });
      mockDbState.seedDoc('printers', 'printer_2', {
        printerId: 'printer_2',
        uid: 'printer_2',
        companyName: 'TapNex Press 2',
        status: 'Active',
      });
      mockDbState.seedDoc('users', 'printer_inactive', {
        uid: 'printer_inactive',
        email: 'inactive-printer@tapnex.in',
        role: 'PRINTER',
        status: 'Active',
      });
      mockDbState.seedDoc('printers', 'printer_inactive', {
        printerId: 'printer_inactive',
        uid: 'printer_inactive',
        companyName: 'Paused Press',
        status: 'Inactive',
      });
      mockDbState.seedDoc('orders', 'ord_disp_1', {
        orderId: 'ord_disp_1',
        orderNumber: 'TNX-2026-DISP1',
        uid: 'user_1',
        printerId: 'printer_1',
        orderStatus: 'Assigned to Printer',
      });
    });

    it('1. rejects unauthenticated, invalid-token, and revoked-token upload/download/delete requests', async () => {
      await expect(
        mod.uploadDispatchDoc({
          auth: null,
          data: {
            orderId: 'ord_disp_1',
            fileName: 'manifest.pdf',
            contentType: 'application/pdf',
            fileData: samplePdfB64,
          },
        })
      ).rejects.toMatchObject({ code: 'unauthenticated' });

      const missingHeaderRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: {},
          query: { orderId: 'ord_disp_1', fileName: 'manifest.pdf' },
        },
        missingHeaderRes
      );
      expect(missingHeaderRes.getStatus()).toBe(401);

      const invalidTokenRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: 'Bearer invalid-token' },
          query: { orderId: 'ord_disp_1', fileName: 'manifest.pdf' },
        },
        invalidTokenRes
      );
      expect(invalidTokenRes.getStatus()).toBe(401);

      const revokedTokenRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${makeTestIdToken({ uid: 'printer_1', revoked: true })}`,
          },
          query: { orderId: 'ord_disp_1', fileName: 'manifest.pdf' },
        },
        revokedTokenRes
      );
      expect(revokedTokenRes.getStatus()).toBe(401);

      await expect(
        mod.deleteDispatchDoc({
          auth: null,
          data: { orderId: 'ord_disp_1', fileName: 'manifest.pdf' },
        })
      ).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('2. rejects normal customer (USER) on upload, download, and delete', async () => {
      await expect(
        mod.uploadDispatchDoc({
          auth: { uid: 'user_1', token: { email: 'user1@tapnex.in', email_verified: true } },
          data: {
            orderId: 'ord_disp_1',
            fileName: 'manifest.pdf',
            contentType: 'application/pdf',
            fileData: samplePdfB64,
          },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      const dlRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${customerToken}` },
          query: { orderId: 'ord_disp_1', fileName: 'manifest.pdf' },
        },
        dlRes
      );
      expect(dlRes.getStatus()).toBe(403);

      await expect(
        mod.deleteDispatchDoc({
          auth: { uid: 'user_1', token: { email: 'user1@tapnex.in', email_verified: true } },
          data: { orderId: 'ord_disp_1', fileName: 'manifest.pdf' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('3. rejects unassigned printer on upload, download, and delete', async () => {
      await expect(
        mod.uploadDispatchDoc({
          auth: { uid: 'printer_2', token: { email: 'printer2@tapnex.in' } },
          data: {
            orderId: 'ord_disp_1',
            fileName: 'manifest.pdf',
            contentType: 'application/pdf',
            fileData: samplePdfB64,
          },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      const dlRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${printer2Token}` },
          query: { orderId: 'ord_disp_1', fileName: 'manifest.pdf' },
        },
        dlRes
      );
      expect(dlRes.getStatus()).toBe(403);

      await expect(
        mod.deleteDispatchDoc({
          auth: { uid: 'printer_2', token: { email: 'printer2@tapnex.in' } },
          data: { orderId: 'ord_disp_1', fileName: 'manifest.pdf' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('4 & 5. streams bytes directly to assigned printer with private no-store headers, never returns signed URL/token, and revokes access immediately on reassignment', async () => {
      const uploadRes = await mod.uploadDispatchDoc({
        auth: { uid: 'printer_1', token: { email: 'printer@tapnex.in' } },
        data: {
          orderId: 'ord_disp_1',
          fileName: 'waybill.pdf',
          contentType: 'application/pdf',
          fileData: samplePdfB64,
          // Attempted spoofed client fields (must be ignored by server)
          role: 'SUPERADMIN',
          assignedPrinterUid: 'spoofed_printer',
          ownerUid: 'spoofed_owner',
        },
      });

      expect(uploadRes).toMatchObject({
        orderId: 'ord_disp_1',
        fileName: 'waybill.pdf',
        storagePath: 'dispatchDocs/ord_disp_1/waybill.pdf',
        contentType: 'application/pdf',
      });
      const stored = mockDbState.storageFiles.get('dispatchDocs/ord_disp_1/waybill.pdf');
      expect(stored?.contentType).toBe('application/pdf');
      expect((stored?.metadata?.metadata as Record<string, unknown>) || {}).toMatchObject({
        orderId: 'ord_disp_1',
        ownerUid: 'user_1',
        assignedPrinterUid: 'printer_1',
        uploadedByUid: 'printer_1',
        uploadedByRole: 'PRINTER',
        contentType: 'application/pdf',
      });

      const dlRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${printer1Token}`,
            origin: 'http://localhost:3000',
          },
          query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
        },
        dlRes
      );

      expect(dlRes.getStatus()).toBe(200);
      expect(dlRes.getBuffer().equals(samplePdfBytes)).toBe(true);
      expect(dlRes.getHeader('cache-control')).toBe('private, no-store, no-cache, must-revalidate');
      expect(dlRes.getHeader('pragma')).toBe('no-cache');
      expect(dlRes.getHeader('x-content-type-options')).toBe('nosniff');
      expect(dlRes.getHeader('content-type')).toBe('application/pdf');
      expect(dlRes.getHeader('content-disposition')).toBe(
        'attachment; filename="waybill.pdf"; filename*=UTF-8\'\'waybill.pdf'
      );
      expect(dlRes.getHeader('access-control-allow-origin')).toBe('http://localhost:3000');
      const streamedText = dlRes.getBuffer().toString('utf8');
      expect(streamedText).not.toContain('storage.googleapis.com');
      expect(streamedText).not.toContain('firebaseStorageDownloadTokens');
      expect(streamedText).not.toContain('X-Goog-Signature');

      // Reassign order to printer_2 -> printer_1 loses access immediately on next request
      await mod.assignPrinter({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: { orderId: 'ord_disp_1', printerId: 'printer_2' },
      });

      const revokedPrinterRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${printer1Token}` },
          query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
        },
        revokedPrinterRes
      );
      expect(revokedPrinterRes.getStatus()).toBe(403);

      // Newly assigned printer_2 can now download
      const newPrinterRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${printer2Token}` },
          query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
        },
        newPrinterRes
      );
      expect(newPrinterRes.getStatus()).toBe(200);
      expect(newPrinterRes.getBuffer().equals(samplePdfBytes)).toBe(true);

      await expect(
        mod.uploadDispatchDoc({
          auth: { uid: 'printer_1', token: { email: 'printer@tapnex.in' } },
          data: {
            orderId: 'ord_disp_1',
            fileName: 'new-waybill.pdf',
            contentType: 'application/pdf',
            fileData: samplePdfB64,
          },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      await expect(
        mod.deleteDispatchDoc({
          auth: { uid: 'printer_1', token: { email: 'printer@tapnex.in' } },
          data: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('6 & 10. allows active verified Admin/SuperAdmin for any order, denies unverified/inactive/missing admin registry, and records audit log on deletion', async () => {
      const uploadRes = await mod.uploadDispatchDoc({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: {
          orderId: 'ord_disp_1',
          fileName: 'dispatch-photo.png',
          contentType: 'image/png',
          fileData: samplePngB64,
        },
      });
      expect(uploadRes.storagePath).toBe('dispatchDocs/ord_disp_1/dispatch-photo.png');

      // Active verified ADMIN succeeds
      const adminDlRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${adminToken}` },
          query: { orderId: 'ord_disp_1', fileName: 'dispatch-photo.png' },
        },
        adminDlRes
      );
      expect(adminDlRes.getStatus()).toBe(200);
      expect(adminDlRes.getBuffer().equals(samplePngBytes)).toBe(true);
      expect(adminDlRes.getHeader('content-type')).toBe('image/png');

      // Active verified SUPERADMIN succeeds via GET
      const superDlRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${superAdminToken}` },
          query: { orderId: 'ord_disp_1', fileName: 'dispatch-photo.png' },
        },
        superDlRes
      );
      expect(superDlRes.getStatus()).toBe(200);
      expect(superDlRes.getBuffer().equals(samplePngBytes)).toBe(true);

      // Unverified email Admin is denied
      const unverifiedRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${unverifiedAdminToken}` },
          query: { orderId: 'ord_disp_1', fileName: 'dispatch-photo.png' },
        },
        unverifiedRes
      );
      expect(unverifiedRes.getStatus()).toBe(403);

      // Admin with missing or inactive admins/{uid} doc is denied (no legacy fallback)
      mockDbState.seedDoc('users', 'legacy_admin', {
        uid: 'legacy_admin',
        email: 'legacy@tapnex.in',
        role: 'ADMIN',
        status: 'Active',
      });
      const legacyAdminRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${makeTestIdToken({ uid: 'legacy_admin', email: 'legacy@tapnex.in', email_verified: true })}`,
          },
          query: { orderId: 'ord_disp_1', fileName: 'dispatch-photo.png' },
        },
        legacyAdminRes
      );
      expect(legacyAdminRes.getStatus()).toBe(403);

      mockDbState.seedDoc('admins', 'admin_1', {
        uid: 'admin_1',
        role: 'ADMIN',
        active: false,
      });
      const inactiveAdminRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${adminToken}` },
          query: { orderId: 'ord_disp_1', fileName: 'dispatch-photo.png' },
        },
        inactiveAdminRes
      );
      expect(inactiveAdminRes.getStatus()).toBe(403);

      // Restore admin_1 active to verify deletion + audit log
      mockDbState.seedDoc('admins', 'admin_1', {
        uid: 'admin_1',
        role: 'ADMIN',
        active: true,
      });

      const delRes = await mod.deleteDispatchDoc({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: { orderId: 'ord_disp_1', fileName: 'dispatch-photo.png' },
      });
      expect(delRes).toMatchObject({
        orderId: 'ord_disp_1',
        fileName: 'dispatch-photo.png',
        storagePath: 'dispatchDocs/ord_disp_1/dispatch-photo.png',
        deleted: true,
      });
      expect(mockDbState.storageFiles.has('dispatchDocs/ord_disp_1/dispatch-photo.png')).toBe(false);

      const logs = Array.from(mockDbState.store.get('auditLogs')?.values() || []);
      expect(
        logs.some(
          (l) =>
            l.action === 'UPLOAD_DISPATCH_DOC' &&
            l.targetCollection === 'dispatchDocs' &&
            l.targetId === 'dispatchDocs/ord_disp_1/dispatch-photo.png' &&
            l.actorUid === 'admin_1'
        )
      ).toBe(true);
      expect(
        logs.some(
          (l) =>
            l.action === 'DELETE_DISPATCH_DOC' &&
            l.targetCollection === 'dispatchDocs' &&
            l.targetId === 'dispatchDocs/ord_disp_1/dispatch-photo.png' &&
            l.actorUid === 'admin_1'
        )
      ).toBe(true);
    });

    it('7. rejects inactive or missing printer records even if assigned to order', async () => {
      mockDbState.seedDoc('orders', 'ord_disp_inactive', {
        orderId: 'ord_disp_inactive',
        uid: 'user_1',
        printerId: 'printer_inactive',
      });

      await expect(
        mod.uploadDispatchDoc({
          auth: { uid: 'printer_inactive', token: { email: 'inactive-printer@tapnex.in' } },
          data: {
            orderId: 'ord_disp_inactive',
            fileName: 'label.pdf',
            contentType: 'application/pdf',
            fileData: samplePdfB64,
          },
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });

      const dlRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${inactivePrinterToken}` },
          query: { orderId: 'ord_disp_inactive', fileName: 'label.pdf' },
        },
        dlRes
      );
      expect(dlRes.getStatus()).toBe(403);
    });

    it('8. rejects invalid orderId/fileName, missing order/file, and mismatched metadata.orderId on download', async () => {
      const badOrderRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${adminToken}` },
          query: { orderId: '../bad', fileName: 'waybill.pdf' },
        },
        badOrderRes
      );
      expect(badOrderRes.getStatus()).toBe(400);

      const badFileRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${adminToken}` },
          query: { orderId: 'ord_disp_1', fileName: '../secret.pdf' },
        },
        badFileRes
      );
      expect(badFileRes.getStatus()).toBe(400);

      const missingOrderRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${adminToken}` },
          query: { orderId: 'ord_missing', fileName: 'waybill.pdf' },
        },
        missingOrderRes
      );
      expect(missingOrderRes.getStatus()).toBe(404);

      const missingFileRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${adminToken}` },
          query: { orderId: 'ord_disp_1', fileName: 'missing.pdf' },
        },
        missingFileRes
      );
      expect(missingFileRes.getStatus()).toBe(404);

      // Seed a storage object with mismatched metadata.orderId -> rejected 403
      mockDbState.storageFiles.set('dispatchDocs/ord_disp_1/tampered.pdf', {
        buffer: samplePdfBytes,
        contentType: 'application/pdf',
        metadata: {
          contentType: 'application/pdf',
          metadata: { orderId: 'other_order' },
        },
      });
      const mismatchRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${adminToken}` },
          query: { orderId: 'ord_disp_1', fileName: 'tampered.pdf' },
        },
        mismatchRes
      );
      expect(mismatchRes.getStatus()).toBe(403);
    });

    it('9. rejects invalid upload filename/MIME types and files larger than 5 MB', async () => {
      await expect(
        mod.uploadDispatchDoc({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: {
            orderId: 'ord_disp_1',
            fileName: '../secret.pdf',
            contentType: 'application/pdf',
            fileData: samplePdfB64,
          },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      await expect(
        mod.uploadDispatchDoc({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: {
            orderId: 'ord_disp_1',
            fileName: 'payload.html',
            contentType: 'text/html',
            fileData: Buffer.from('<script>alert(1)</script>').toString('base64'),
          },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      // Extension/MIME mismatch rejected
      await expect(
        mod.uploadDispatchDoc({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: {
            orderId: 'ord_disp_1',
            fileName: 'label.pdf',
            contentType: 'image/png',
            fileData: samplePngB64,
          },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      // Exactly 5 MB succeeds without stack/size error
      const maxAllowedBase64 = Buffer.alloc(5 * 1024 * 1024, 0x41).toString('base64');
      const maxRes = await mod.uploadDispatchDoc({
        auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
        data: {
          orderId: 'ord_disp_1',
          fileName: 'exact-5mb.jpg',
          contentType: 'image/jpeg',
          fileData: maxAllowedBase64,
        },
      });
      expect(maxRes.sizeBytes).toBe(5 * 1024 * 1024);

      // > 5 MB rejected (5 * 1024 * 1024 + 1 bytes)
      const oversizedBase64 = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41).toString('base64');
      await expect(
        mod.uploadDispatchDoc({
          auth: { uid: 'admin_1', token: { email: 'admin@tapnex.in', email_verified: true } },
          data: {
            orderId: 'ord_disp_1',
            fileName: 'oversized.jpg',
            contentType: 'image/jpeg',
            fileData: oversizedBase64,
          },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('11. handles CORS OPTIONS preflight without auth, rejects evil and generic *.run.app origins, and rejects unsupported methods with 405', async () => {
      // Trusted production origin preflight returns 204 with exact CORS headers (no auth required)
      const trustedPreflight = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'OPTIONS',
          headers: { origin: 'https://tapnex.in' },
        },
        trustedPreflight
      );
      expect(trustedPreflight.getStatus()).toBe(204);
      expect(trustedPreflight.getHeader('access-control-allow-origin')).toBe('https://tapnex.in');
      expect(trustedPreflight.getHeader('vary')).toBe('Origin');
      expect(trustedPreflight.getHeader('access-control-allow-methods')).toBe('GET, OPTIONS');
      expect(trustedPreflight.getHeader('access-control-allow-headers')).toBe('Authorization, Content-Type');
      expect(trustedPreflight.getHeader('access-control-expose-headers')).toBe('Content-Disposition, Content-Type');

      // Configured APP_URL / VITE_APP_URL is allowed when set
      const prevAppUrl = process.env.APP_URL;
      process.env.APP_URL = 'https://portal.tapnex.in/';
      try {
        const configuredPreflight = createStreamingMockRes();
        await mod.downloadDispatchDoc(
          {
            method: 'OPTIONS',
            headers: { origin: 'https://portal.tapnex.in' },
          },
          configuredPreflight
        );
        expect(configuredPreflight.getStatus()).toBe(204);
        expect(configuredPreflight.getHeader('access-control-allow-origin')).toBe('https://portal.tapnex.in');
      } finally {
        if (prevAppUrl === undefined) delete process.env.APP_URL;
        else process.env.APP_URL = prevAppUrl;
      }

      // Evil origin & arbitrary *.run.app origin must receive NO Access-Control-Allow-Origin
      for (const untrustedOrigin of ['https://evil.example', 'https://attacker-123.us-central1.run.app']) {
        const evilPreflight = createStreamingMockRes();
        await mod.downloadDispatchDoc(
          {
            method: 'OPTIONS',
            headers: { origin: untrustedOrigin },
          },
          evilPreflight
        );
        expect(evilPreflight.getStatus()).toBe(204);
        expect(evilPreflight.getHeader('access-control-allow-origin')).toBeUndefined();

        const evilGet = createStreamingMockRes();
        await mod.downloadDispatchDoc(
          {
            method: 'GET',
            headers: {
              origin: untrustedOrigin,
              authorization: `Bearer ${adminToken}`,
            },
            query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
          },
          evilGet
        );
        expect(evilGet.getHeader('access-control-allow-origin')).toBeUndefined();
      }

      // Unsupported HTTP methods (POST, PUT, DELETE) return 405
      for (const badMethod of ['POST', 'PUT', 'DELETE']) {
        const methodRes = createStreamingMockRes();
        await mod.downloadDispatchDoc(
          {
            method: badMethod,
            headers: { authorization: `Bearer ${adminToken}` },
            query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
          },
          methodRes
        );
        expect(methodRes.getStatus()).toBe(405);
      }
    });

    it('12. rejects Blocked, Disabled, and Pending Verification users and missing/disabled/blocked printers on downloadDispatchDoc', async () => {
      mockDbState.storageFiles.set('dispatchDocs/ord_disp_1/waybill.pdf', {
        buffer: samplePdfBytes,
        contentType: 'application/pdf',
        metadata: {
          contentType: 'application/pdf',
          metadata: { orderId: 'ord_disp_1' },
        },
      });

      // Blocked, Disabled, Pending Verification on users/{uid}.status for assigned printer & active admin
      for (const status of ['Blocked', 'Disabled', 'Pending Verification'] as const) {
        mockDbState.seedDoc('users', 'printer_1', {
          uid: 'printer_1',
          email: 'printer@tapnex.in',
          role: 'PRINTER',
          status,
        });
        const printerStatusRes = createStreamingMockRes();
        await mod.downloadDispatchDoc(
          {
            method: 'GET',
            headers: { authorization: `Bearer ${printer1Token}` },
            query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
          },
          printerStatusRes
        );
        expect(printerStatusRes.getStatus()).toBe(403);

        mockDbState.seedDoc('users', 'admin_1', {
          uid: 'admin_1',
          email: 'admin@tapnex.in',
          role: 'ADMIN',
          status,
        });
        const adminStatusRes = createStreamingMockRes();
        await mod.downloadDispatchDoc(
          {
            method: 'GET',
            headers: { authorization: `Bearer ${adminToken}` },
            query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
          },
          adminStatusRes
        );
        expect(adminStatusRes.getStatus()).toBe(403);
      }

      // Restore users/{uid} active
      mockDbState.seedDoc('users', 'printer_1', {
        uid: 'printer_1',
        email: 'printer@tapnex.in',
        role: 'PRINTER',
        status: 'Active',
      });
      mockDbState.seedDoc('users', 'admin_1', {
        uid: 'admin_1',
        email: 'admin@tapnex.in',
        role: 'ADMIN',
        status: 'Active',
      });

      // Disabled / Blocked / Pending Verification on printers/{uid}.status
      for (const printerStatus of ['Disabled', 'Blocked', 'Pending Verification'] as const) {
        mockDbState.seedDoc('printers', 'printer_1', {
          printerId: 'printer_1',
          uid: 'printer_1',
          companyName: 'TapNex Press 1',
          status: printerStatus,
        });
        const res = createStreamingMockRes();
        await mod.downloadDispatchDoc(
          {
            method: 'GET',
            headers: { authorization: `Bearer ${printer1Token}` },
            query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
          },
          res
        );
        expect(res.getStatus()).toBe(403);
      }

      // Missing printers/{uid} record even if users/{uid}.role === 'PRINTER' and order assigned
      mockDbState.seedDoc('users', 'printer_missing', {
        uid: 'printer_missing',
        email: 'missing@tapnex.in',
        role: 'PRINTER',
        status: 'Active',
      });
      mockDbState.seedDoc('orders', 'ord_missing_printer', {
        orderId: 'ord_missing_printer',
        uid: 'user_1',
        printerId: 'printer_missing',
      });
      const missingPrinterRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${makeTestIdToken({ uid: 'printer_missing', email: 'missing@tapnex.in', email_verified: true })}`,
          },
          query: { orderId: 'ord_missing_printer', fileName: 'waybill.pdf' },
        },
        missingPrinterRes
      );
      expect(missingPrinterRes.getStatus()).toBe(403);
    });

    it('13. rejects non-Bearer, empty Bearer token, and token without uid with 401', async () => {
      const nonBearerRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Token ${adminToken}` },
          query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
        },
        nonBearerRes
      );
      expect(nonBearerRes.getStatus()).toBe(401);

      const emptyBearerRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: 'Bearer    ' },
          query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
        },
        emptyBearerRes
      );
      expect(emptyBearerRes.getStatus()).toBe(401);

      const noUidRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${makeTestIdToken({ simulateMissingUid: true, email: 'nouid@tapnex.in' })}`,
          },
          query: { orderId: 'ord_disp_1', fileName: 'waybill.pdf' },
        },
        noUidRes
      );
      expect(noUidRes.getStatus()).toBe(401);
    });

    it('14 & 15. handles storage stream errors safely before and after response headers are sent', async () => {
      // Stream error BEFORE headers are written -> safe 500 JSON response, no binary bytes leaked
      mockDbState.storageFiles.set('dispatchDocs/ord_disp_1/err-before.pdf', {
        buffer: samplePdfBytes,
        contentType: 'application/pdf',
        metadata: {
          contentType: 'application/pdf',
          metadata: { orderId: 'ord_disp_1' },
        },
        mockStreamBehavior: 'error-before-data',
      });

      const beforeRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${adminToken}` },
          query: { orderId: 'ord_disp_1', fileName: 'err-before.pdf' },
        },
        beforeRes
      );
      expect(beforeRes.getStatus()).toBe(500);
      expect(beforeRes.getBody()).toMatchObject({ error: 'Simulated storage read error before headers' });
      expect(beforeRes.getBuffer().length).toBe(0);

      // Stream error AFTER headers/first chunk are sent -> destroys response safely, never appends JSON error
      mockDbState.storageFiles.set('dispatchDocs/ord_disp_1/err-after.pdf', {
        buffer: samplePdfBytes,
        contentType: 'application/pdf',
        metadata: {
          contentType: 'application/pdf',
          metadata: { orderId: 'ord_disp_1' },
        },
        mockStreamBehavior: 'error-after-chunk',
      });

      const afterRes = createStreamingMockRes();
      await mod.downloadDispatchDoc(
        {
          method: 'GET',
          headers: { authorization: `Bearer ${adminToken}` },
          query: { orderId: 'ord_disp_1', fileName: 'err-after.pdf' },
        },
        afterRes
      );
      expect(afterRes.headersSent).toBe(true);
      expect(afterRes.destroyed).toBe(true);
      expect(afterRes.getBody()).toBeUndefined();
      expect(afterRes.getBuffer().toString('utf8')).toBe('%PDF-1.4');
    });
  });
});
