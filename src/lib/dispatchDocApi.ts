import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase';

export interface DispatchDocMetadata {
  orderId: string;
  ownerUid: string;
  assignedPrinterUid: string;
  uploadedByUid: string;
  uploadedByRole: 'PRINTER' | 'ADMIN' | 'SUPERADMIN';
  contentType: string;
  createdAt: string;
}

export interface UploadDispatchDocRequest {
  orderId: string;
  fileName: string;
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
  fileData: string;
}

export interface UploadDispatchDocResponse {
  orderId: string;
  fileName: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  metadata: DispatchDocMetadata;
}

export interface DownloadDispatchDocRequest {
  orderId: string;
  fileName: string;
}

export interface DeleteDispatchDocRequest {
  orderId: string;
  fileName: string;
}

export interface DeleteDispatchDocResponse {
  orderId: string;
  fileName: string;
  storagePath: string;
  deleted: boolean;
}

async function requireAuthenticatedToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required. Please sign in again to continue.');
  }
  return user.getIdToken();
}

function resolveDownloadDispatchDocEndpoint(): string {
  const explicit = import.meta.env.VITE_DISPATCH_DOC_DOWNLOAD_URL;
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim().replace(/\/+$/, '');
  }
  if (functions.customDomain) {
    return `${functions.customDomain.replace(/\/+$/, '')}/downloadDispatchDoc`;
  }
  const projectId = String(functions.app.options.projectId || '').trim();
  const region = String(functions.region || 'us-central1').trim();
  if (!projectId) {
    throw new Error('Firebase project ID is not configured for dispatch document download.');
  }
  return `https://${region}-${projectId}.cloudfunctions.net/downloadDispatchDoc`;
}

function extractCallableErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const maybeErr = err as { message?: unknown; details?: unknown };
    if (typeof maybeErr.details === 'string' && maybeErr.details.trim()) {
      return maybeErr.details.trim();
    }
    if (typeof maybeErr.message === 'string' && maybeErr.message.trim()) {
      return maybeErr.message.replace(/^FirebaseError:\s*/i, '').trim();
    }
  }
  return fallback;
}

export async function uploadDispatchDoc(
  payload: UploadDispatchDocRequest
): Promise<UploadDispatchDocResponse> {
  await requireAuthenticatedToken();
  const callable = httpsCallable<UploadDispatchDocRequest, UploadDispatchDocResponse>(
    functions,
    'uploadDispatchDoc'
  );
  try {
    const res = await callable(payload);
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to upload dispatch document.'));
  }
}

export async function downloadDispatchDoc(
  payload: DownloadDispatchDocRequest
): Promise<Blob> {
  const idToken = await requireAuthenticatedToken();
  const endpoint = resolveDownloadDispatchDocEndpoint();
  const url = `${endpoint}?orderId=${encodeURIComponent(payload.orderId)}&fileName=${encodeURIComponent(payload.fileName)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    let errorMessage = `Dispatch document download failed (HTTP ${response.status}).`;
    try {
      const text = await response.text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as { error?: unknown };
          if (typeof parsed.error === 'string' && parsed.error.trim()) {
            errorMessage = parsed.error.trim();
          }
        } catch {
          errorMessage = text.slice(0, 300);
        }
      }
    } catch {
      // ignore body read errors
    }
    throw new Error(errorMessage);
  }

  return response.blob();
}

export async function deleteDispatchDoc(
  payload: DeleteDispatchDocRequest
): Promise<DeleteDispatchDocResponse> {
  await requireAuthenticatedToken();
  const callable = httpsCallable<DeleteDispatchDocRequest, DeleteDispatchDocResponse>(
    functions,
    'deleteDispatchDoc'
  );
  try {
    const res = await callable(payload);
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to delete dispatch document.'));
  }
}
