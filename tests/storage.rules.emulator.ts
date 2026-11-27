/**
 * Firebase Storage Emulator Security Rules Verification Script
 *
 * Run against Firebase Local Emulator Suite:
 *   npm i -D @firebase/rules-unit-testing
 *   firebase emulators:exec --only storage "npx vitest run tests/storage.rules.emulator.ts"
 */
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'gen-lang-client-0847571180';

interface RulesUnitTestingApi {
  initializeTestEnvironment: (config: {
    projectId: string;
    storage: { host: string; port: number; rules: string };
  }) => Promise<{
    authenticatedContext: (
      uid: string,
      tokenOptions?: Record<string, unknown>
    ) => { storage: () => unknown };
    unauthenticatedContext: () => { storage: () => unknown };
    withSecurityRulesDisabled: (fn: (ctx: { storage: () => unknown }) => Promise<void>) => Promise<void>;
    cleanup: () => Promise<void>;
  }>;
  assertFails: (promise: Promise<unknown>) => Promise<unknown>;
  assertSucceeds: (promise: Promise<unknown>) => Promise<unknown>;
}

describe('Firebase Storage Security Rules Emulator Suite (dispatchDocs & qrCodes)', () => {
  let testEnv: Awaited<ReturnType<RulesUnitTestingApi['initializeTestEnvironment']>>;
  let assertFails: RulesUnitTestingApi['assertFails'];
  let assertSucceeds: RulesUnitTestingApi['assertSucceeds'];

  beforeAll(async () => {
    const pkgName = '@firebase/rules-unit-testing';
    const mod = (await import(pkgName)) as RulesUnitTestingApi;
    assertFails = mod.assertFails;
    assertSucceeds = mod.assertSucceeds;
    testEnv = await mod.initializeTestEnvironment({
      projectId: PROJECT_ID,
      storage: {
        host: '127.0.0.1',
        port: 9199,
        rules: fs.readFileSync(path.resolve(process.cwd(), 'storage.rules'), 'utf8'),
      },
    });

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const storage = ctx.storage() as {
        ref: (p: string) => { putString: (s: string) => Promise<unknown> };
      };
      await storage.ref('dispatchDocs/ord_emu_1/waybill.pdf').putString('%PDF-1.4 sample');
      await storage.ref('qrCodes/ord_emu_1/qr.png').putString('png-data');
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  it('denies direct client reads and uploads under dispatchDocs/{orderId}/{fileName} for ALL roles including Admin and Printer', async () => {
    const contexts = [
      testEnv.unauthenticatedContext(),
      testEnv.authenticatedContext('user_1', { email: 'user@tapnex.in', email_verified: true, role: 'USER' }),
      testEnv.authenticatedContext('printer_1', {
        email: 'printer@tapnex.in',
        email_verified: true,
        role: 'PRINTER',
      }),
      testEnv.authenticatedContext('admin_1', {
        email: 'admin@tapnex.in',
        email_verified: true,
        role: 'ADMIN',
      }),
      testEnv.authenticatedContext('super_1', {
        email: 'jeetendrakulkarniai@gmail.com',
        email_verified: true,
        role: 'SUPERADMIN',
      }),
    ];

    for (const ctx of contexts) {
      const st = ctx.storage() as {
        ref: (p: string) => {
          getBytes: (max?: number) => Promise<unknown>;
          putString: (s: string) => Promise<unknown>;
        };
      };
      await assertFails(st.ref('dispatchDocs/ord_emu_1/waybill.pdf').getBytes());
      await assertFails(st.ref('dispatchDocs/ord_emu_1/client-upload.pdf').putString('blocked'));
    }
  });

  it('preserves existing qrCodes/{orderId}/{fileName} read restriction (Admin/Printer read allowed, Customer/Unauth denied, all client writes denied)', async () => {
    const unauthStorage = testEnv.unauthenticatedContext().storage() as {
      ref: (p: string) => { getBytes: () => Promise<unknown>; putString: (s: string) => Promise<unknown> };
    };
    const userStorage = testEnv
      .authenticatedContext('user_1', { email: 'user@tapnex.in', email_verified: true, role: 'USER' })
      .storage() as {
      ref: (p: string) => { getBytes: () => Promise<unknown>; putString: (s: string) => Promise<unknown> };
    };
    const printerStorage = testEnv
      .authenticatedContext('printer_1', { email: 'printer@tapnex.in', email_verified: true, role: 'PRINTER' })
      .storage() as {
      ref: (p: string) => { getBytes: () => Promise<unknown>; putString: (s: string) => Promise<unknown> };
    };
    const adminStorage = testEnv
      .authenticatedContext('admin_1', { email: 'admin@tapnex.in', email_verified: true, role: 'ADMIN' })
      .storage() as {
      ref: (p: string) => { getBytes: () => Promise<unknown>; putString: (s: string) => Promise<unknown> };
    };

    await assertFails(unauthStorage.ref('qrCodes/ord_emu_1/qr.png').getBytes());
    await assertFails(userStorage.ref('qrCodes/ord_emu_1/qr.png').getBytes());
    await assertSucceeds(printerStorage.ref('qrCodes/ord_emu_1/qr.png').getBytes());
    await assertSucceeds(adminStorage.ref('qrCodes/ord_emu_1/qr.png').getBytes());

    await assertFails(printerStorage.ref('qrCodes/ord_emu_1/qr.png').putString('forged'));
    await assertFails(adminStorage.ref('qrCodes/ord_emu_1/qr.png').putString('forged'));
  });
});
