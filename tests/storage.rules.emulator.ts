
/**
 * Firebase Storage Emulator Security Rules Verification Script
 *
 * Run against Firebase Local Emulator Suite:
 *   npm i -D @firebase/rules-unit-testing
 *   firebase emulators:exec --only storage "npx vitest run tests/storage.rules.emulator.ts"
 */

import {
  ref,
  getBytes,
  uploadString,
  type FirebaseStorage,
} from 'firebase/storage';

import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, it } from 'vitest';

// Must match the demo project ID used by the Storage Emulator command.
const PROJECT_ID = 'demo-tapnex-storage';

interface RulesUnitTestingContext {
  storage: () => FirebaseStorage;
}

interface RulesUnitTestingApi {
  initializeTestEnvironment: (config: {
    projectId: string;
    storage: {
      host: string;
      port: number;
      rules: string;
    };
  }) => Promise<{
    authenticatedContext: (
      uid: string,
      tokenOptions?: Record<string, unknown>
    ) => RulesUnitTestingContext;

    unauthenticatedContext: () => RulesUnitTestingContext;

    withSecurityRulesDisabled: (
      fn: (ctx: RulesUnitTestingContext) => Promise<void>
    ) => Promise<void>;

    cleanup: () => Promise<void>;
  }>;

  assertFails: (promise: Promise<unknown>) => Promise<unknown>;
  assertSucceeds: (promise: Promise<unknown>) => Promise<unknown>;
}

describe('Firebase Storage Security Rules Emulator Suite (dispatchDocs & qrCodes)', () => {
  let testEnv: Awaited<
    ReturnType<RulesUnitTestingApi['initializeTestEnvironment']>
  >;

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
        rules: fs.readFileSync(
          path.resolve(process.cwd(), 'storage.rules'),
          'utf8'
        ),
      },
    });

    // Seed test files with Security Rules disabled.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const storage = ctx.storage();

      await uploadString(
        ref(storage, 'dispatchDocs/ord_emu_1/waybill.pdf'),
        '%PDF-1.4 sample'
      );

      await uploadString(
        ref(storage, 'qrCodes/ord_emu_1/qr.png'),
        'png-data'
      );
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  it(
    'denies direct client reads and uploads under dispatchDocs/{orderId}/{fileName} for ALL roles including Admin and Printer',
    async () => {
      const contexts = [
        testEnv.unauthenticatedContext(),

        testEnv.authenticatedContext('user_1', {
          email: 'user@tapnex.in',
          email_verified: true,
          role: 'USER',
        }),

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
        const storage = ctx.storage();

        // All roles must be denied direct reads.
        await assertFails(
          getBytes(
            ref(storage, 'dispatchDocs/ord_emu_1/waybill.pdf')
          )
        );

        // All roles must be denied direct uploads.
        await assertFails(
          uploadString(
            ref(storage, 'dispatchDocs/ord_emu_1/client-upload.pdf'),
            'blocked'
          )
        );
      }
    }
  );

  it(
    'preserves existing qrCodes/{orderId}/{fileName} read restriction (Admin/Printer read allowed, Customer/Unauth denied, all client writes denied)',
    async () => {
      const unauthStorage = testEnv
        .unauthenticatedContext()
        .storage();

      const userStorage = testEnv
        .authenticatedContext('user_1', {
          email: 'user@tapnex.in',
          email_verified: true,
          role: 'USER',
        })
        .storage();

      const printerStorage = testEnv
        .authenticatedContext('printer_1', {
          email: 'printer@tapnex.in',
          email_verified: true,
          role: 'PRINTER',
        })
        .storage();

      const adminStorage = testEnv
        .authenticatedContext('admin_1', {
          email: 'admin@tapnex.in',
          email_verified: true,
          role: 'ADMIN',
        })
        .storage();

      const qrPath = 'qrCodes/ord_emu_1/qr.png';

      // Unauthenticated users and customers cannot read QR files.
      await assertFails(
        getBytes(ref(unauthStorage, qrPath))
      );

      await assertFails(
        getBytes(ref(userStorage, qrPath))
      );

      // Printers and admins can read QR files.
      await assertSucceeds(
        getBytes(ref(printerStorage, qrPath))
      );

      await assertSucceeds(
        getBytes(ref(adminStorage, qrPath))
      );

      // Clients cannot upload or overwrite QR files.
      await assertFails(
        uploadString(ref(printerStorage, qrPath), 'forged')
      );

      await assertFails(
        uploadString(ref(adminStorage, qrPath), 'forged')
      );
    }
  );
});
