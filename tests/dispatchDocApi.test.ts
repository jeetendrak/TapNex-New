import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    currentUser: null as { getIdToken: () => Promise<string> } | null,
    customDomain: null as string | null,
    projectId: 'gen-lang-client-0847571180',
    region: 'us-central1',
    callableMap: new Map<string, (payload: unknown) => Promise<unknown>>(),
  };

  const httpsCallableMock = vi.fn((_functionsArg: unknown, name: string) => {
    return async (payload: unknown) => {
      const fn = state.callableMap.get(name);
      if (!fn) {
        throw new Error(`Unexpected callable: ${name}`);
      }
      return fn(payload);
    };
  });

  return { state, httpsCallableMock };
});

vi.mock('firebase/functions', () => ({
  httpsCallable: mocks.httpsCallableMock,
}));

vi.mock('../src/lib/firebase', () => ({
  auth: {
    get currentUser() {
      return mocks.state.currentUser;
    },
  },
  functions: {
    get customDomain() {
      return mocks.state.customDomain;
    },
    app: {
      options: {
        get projectId() {
          return mocks.state.projectId;
        },
      },
    },
    get region() {
      return mocks.state.region;
    },
  },
}));

import { deleteDispatchDoc, downloadDispatchDoc, uploadDispatchDoc } from '../src/lib/dispatchDocApi';

describe('dispatchDocApi frontend runtime', () => {
  beforeEach(() => {
    mocks.state.currentUser = null;
    mocks.state.customDomain = null;
    mocks.state.projectId = 'gen-lang-client-0847571180';
    mocks.state.region = 'us-central1';
    mocks.state.callableMap.clear();
    mocks.httpsCallableMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rejects downloadDispatchDoc when no user is signed in without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      downloadDispatchDoc({ orderId: 'ord_101', fileName: 'waybill.pdf' })
    ).rejects.toThrow('Authentication required');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls currentUser.getIdToken(), sends token only in Authorization header, never uses signed URLs/tokens in query, and returns Blob', async () => {
    const getIdTokenMock = vi.fn().mockResolvedValue('eyJ-firebase-id-token-123');
    mocks.state.currentUser = { getIdToken: getIdTokenMock };

    const expectedBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const expectedBlob = new Blob([expectedBytes], { type: 'application/pdf' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(expectedBlob, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const blob = await downloadDispatchDoc({
      orderId: 'ord_101',
      fileName: 'waybill final.pdf',
    });

    expect(getIdTokenMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      'https://us-central1-gen-lang-client-0847571180.cloudfunctions.net/downloadDispatchDoc?orderId=ord_101&fileName=waybill%20final.pdf'
    );
    expect(calledUrl).not.toContain('eyJ-firebase-id-token-123');
    expect(calledUrl).not.toContain('token=');
    expect(calledUrl).not.toContain('X-Goog-Signature');
    expect(calledUrl).not.toContain('getSignedUrl');

    expect(calledInit.method).toBe('GET');
    expect(calledInit.cache).toBe('no-store');
    expect(calledInit.headers).toEqual({
      Authorization: 'Bearer eyJ-firebase-id-token-123',
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(expectedBytes);
  });

  it('honors VITE_DISPATCH_DOC_DOWNLOAD_URL override while keeping token in Authorization header only', async () => {
    const getIdTokenMock = vi.fn().mockResolvedValue('tok_override_456');
    mocks.state.currentUser = { getIdToken: getIdTokenMock };
    vi.stubEnv('VITE_DISPATCH_DOC_DOWNLOAD_URL', 'https://downloaddispatchdoc-abc-uc.a.run.app/');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await downloadDispatchDoc({ orderId: 'ord_202', fileName: 'proof.png' });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      'https://downloaddispatchdoc-abc-uc.a.run.app?orderId=ord_202&fileName=proof.png'
    );
    expect(calledUrl).not.toContain('tok_override_456');
    expect(calledInit.headers).toEqual({ Authorization: 'Bearer tok_override_456' });
  });

  it('surfaces JSON error message or HTTP status text when download response fails', async () => {
    mocks.state.currentUser = {
      getIdToken: vi.fn().mockResolvedValue('tok_err_789'),
    };

    const jsonErrorFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Printer can only access dispatch documents for orders currently assigned to their account.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', jsonErrorFetch);

    await expect(
      downloadDispatchDoc({ orderId: 'ord_999', fileName: 'waybill.pdf' })
    ).rejects.toThrow('Printer can only access dispatch documents for orders currently assigned to their account.');

    const plainErrorFetch = vi.fn().mockResolvedValue(
      new Response('Upstream gateway timeout', { status: 504 })
    );
    vi.stubGlobal('fetch', plainErrorFetch);

    await expect(
      downloadDispatchDoc({ orderId: 'ord_999', fileName: 'waybill.pdf' })
    ).rejects.toThrow('Upstream gateway timeout');
  });

  it('invokes uploadDispatchDoc and deleteDispatchDoc via authenticated httpsCallable', async () => {
    const getIdTokenMock = vi.fn().mockResolvedValue('tok_callable_1');
    mocks.state.currentUser = { getIdToken: getIdTokenMock };

    const uploadFn = vi.fn().mockResolvedValue({
      data: {
        orderId: 'ord_101',
        fileName: 'waybill.pdf',
        storagePath: 'dispatchDocs/ord_101/waybill.pdf',
        contentType: 'application/pdf',
        sizeBytes: 12,
        metadata: {
          orderId: 'ord_101',
          ownerUid: 'user_1',
          assignedPrinterUid: 'printer_1',
          uploadedByUid: 'printer_1',
          uploadedByRole: 'PRINTER',
          contentType: 'application/pdf',
          createdAt: '2026-11-27T00:00:00.000Z',
        },
      },
    });
    const deleteFn = vi.fn().mockResolvedValue({
      data: {
        orderId: 'ord_101',
        fileName: 'waybill.pdf',
        storagePath: 'dispatchDocs/ord_101/waybill.pdf',
        deleted: true,
      },
    });
    mocks.state.callableMap.set('uploadDispatchDoc', uploadFn);
    mocks.state.callableMap.set('deleteDispatchDoc', deleteFn);

    const upRes = await uploadDispatchDoc({
      orderId: 'ord_101',
      fileName: 'waybill.pdf',
      contentType: 'application/pdf',
      fileData: 'JVBERi0xLjQ=',
    });
    expect(upRes.storagePath).toBe('dispatchDocs/ord_101/waybill.pdf');
    expect(uploadFn).toHaveBeenCalledTimes(1);

    const delRes = await deleteDispatchDoc({ orderId: 'ord_101', fileName: 'waybill.pdf' });
    expect(delRes.deleted).toBe(true);
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(getIdTokenMock).toHaveBeenCalledTimes(2);
  });
});
