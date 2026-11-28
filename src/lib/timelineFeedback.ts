import { ORDER_STATUS_FLOW } from './constants';
import { formatFirestoreErrorMessage } from './cardDesignSize';
import type { OrderStatus } from '../types';

export const ADMIN_MANUAL_ORDER_STATUS_OPTIONS: OrderStatus[] = [
  ...ORDER_STATUS_FLOW.filter((status) => status !== 'Payment Successful'),
  'Cancelled',
];

export function sanitizeTimelineErrorMessage(
  err: unknown,
  fallback = 'Unable to update order status. Please try again.'
): string {
  const formatted = formatFirestoreErrorMessage(err, fallback)
    .replace(/^FirebaseError:\s*/i, '')
    .replace(/^HttpsError:\s*/i, '')
    .replace(/\s*\(functions\/[a-z0-9-]+\)\.?$/i, '')
    .trim();

  if (!formatted) {
    return fallback;
  }

  // Strip stack traces if any leaked into the message
  const withoutStack = formatted.split(/\r?\n\s+at\s+/)[0].trim();
  const lower = withoutStack.toLowerCase();

  if (
    lower.includes('authentication required') ||
    lower.includes('sign in required') ||
    lower.includes('auth required') ||
    lower.includes('unauthenticated')
  ) {
    return 'Your session has expired. Please sign in again and retry.';
  }

  if (lower.includes('account verification is pending')) {
    return 'Account verification is pending. Verify your account before updating orders.';
  }

  if (lower.includes('verified email session is required')) {
    return 'A verified email session is required before updating order status.';
  }

  if (lower.includes('blocked or disabled') || lower.includes('admin account is inactive')) {
    return 'Your account does not currently have active permission to update order status.';
  }

  if (
    lower.includes('assigned to its linked print auth id') ||
    lower.includes('active linked printer facility is required')
  ) {
    return 'This order is not assigned to your active printer facility.';
  }

  if (lower.includes('affects payment state') || lower.includes('adminreconcileorderpayment')) {
    return 'Payment-controlled statuses must be updated via Payment Reconciliation.';
  }

  if (lower.includes('not-found') || /^order\s+\S+\s+not found\.?$/i.test(withoutStack)) {
    return 'This order could not be found. Refresh the page and try again.';
  }

  if (
    lower === 'internal' ||
    lower === 'unavailable' ||
    lower === 'unknown' ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('cors') ||
    lower.includes('cloudfunctions.net') ||
    lower.includes('deadline-exceeded') ||
    lower.includes('err_failed')
  ) {
    return 'Could not reach the order update service right now. Please try again in a moment.';
  }

  if (
    withoutStack.startsWith('{') ||
    withoutStack.includes('http://') ||
    withoutStack.includes('https://') ||
    withoutStack.includes('/app/')
  ) {
    return fallback;
  }

  return withoutStack.length > 220 ? `${withoutStack.slice(0, 217)}...` : withoutStack;
}

export interface ExecuteTimelineStatusUpdateParams {
  orderId: string;
  currentStatus: OrderStatus;
  nextStatus: OrderStatus;
  hasUserSession: boolean;
  isUpdating: boolean;
  updateOrderStatusFn: (
    orderId: string,
    orderStatus: OrderStatus
  ) => Promise<{ orderId: string; orderStatus: OrderStatus }>;
  onStart?: (nextStatus: OrderStatus) => void;
  onOptimisticUpdate?: (nextStatus: OrderStatus) => void;
  onSuccess?: (nextStatus: OrderStatus) => Promise<void> | void;
  onError?: (friendlyMessage: string) => void;
  onFinish?: () => void;
}

export async function executeTimelineStatusUpdate(
  params: ExecuteTimelineStatusUpdateParams
): Promise<{ ok: boolean; ignored?: boolean; error?: string }> {
  if (params.isUpdating) {
    return { ok: false, ignored: true };
  }

  if (!params.hasUserSession) {
    const msg = 'Your session has expired. Please sign in again and retry.';
    params.onError?.(msg);
    return { ok: false, error: msg };
  }

  if (params.nextStatus === params.currentStatus) {
    return { ok: true, ignored: true };
  }

  params.onStart?.(params.nextStatus);
  try {
    await params.updateOrderStatusFn(params.orderId, params.nextStatus);
    params.onOptimisticUpdate?.(params.nextStatus);
    await params.onSuccess?.(params.nextStatus);
    return { ok: true };
  } catch (err) {
    const friendlyMessage = sanitizeTimelineErrorMessage(err);
    params.onError?.(friendlyMessage);
    return { ok: false, error: friendlyMessage };
  } finally {
    params.onFinish?.();
  }
}
