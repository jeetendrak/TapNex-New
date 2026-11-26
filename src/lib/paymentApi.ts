import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase';

import type {
  OrderStatus,
  PaymentStatus,
  QrCodeRecord,
  ShippingAddress,
} from '../types';

export interface CreatePaymentOrderResponse {
  gatewayOrderId: string;
  amountPaise: number;
  currency: 'INR';
  keyId: string;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  reused: boolean;
}

export interface VerifyPaymentRequest {
  orderId: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  signature: string;
}

export interface VerifyPaymentResponse {
  verified: boolean;
  alreadyVerified: boolean;
  orderId: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  amountPaise: number;
}

export interface GeneratePurchasedQrResponse {
  qrCodeId: string;
  targetUrl: string;
  alreadyExists?: boolean;
}

export interface AdminReconcileOrderPaymentRequest {
  orderId: string;
  paymentStatus: PaymentStatus;
  orderStatus?: OrderStatus;
  reason: string;
  gatewayReference?: string;
}

export interface AdminReconcileOrderPaymentResponse {
  orderId: string;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
}

export interface AdminReconcileProfilePaymentRequest {
  profileId: string;
  completed: boolean;
  reference?: string;
  reason?: string;
}

export interface AdminReconcileProfilePaymentResponse {
  profileId: string;
  slug: string;
  paymentConfirmed: boolean;
  paymentCompletedAt: string;
  paymentReference: string;
  isPublic: boolean;
}

export interface AdminSendDesignToPrintRequest {
  designId: string;
  orderId?: string;
  printerId: string;
  initialOrderStatus: OrderStatus;
  cardType?: string;
  quantity: number;
  complimentary?: boolean;
  complimentaryReason?: string;
  shippingAddress: ShippingAddress;
  notes?: string;
}

export interface AdminSendDesignToPrintResponse {
  orderId: string;
  orderNumber: string;
  complimentary?: boolean;
  paymentStatus?: PaymentStatus;
  qrRecord: QrCodeRecord;
}

export interface GenerateAdminQrRequest {
  targetUrl: string;
  customerName?: string;
  orderId?: string;
  description?: string;
}

async function requireAuthenticatedSession(): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required. Please sign in again to continue.');
  }
  await user.getIdToken();
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

export async function createPaymentOrder(orderId: string): Promise<CreatePaymentOrderResponse> {
  await requireAuthenticatedSession();
  const callable = httpsCallable<{ orderId: string }, CreatePaymentOrderResponse>(
    functions,
    'createPaymentOrder'
  );
  try {
    const res = await callable({ orderId });
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to initialize Razorpay payment order.'));
  }
}

export async function verifyPayment(
  payload: VerifyPaymentRequest
): Promise<VerifyPaymentResponse> {
  await requireAuthenticatedSession();
  const callable = httpsCallable<VerifyPaymentRequest, VerifyPaymentResponse>(
    functions,
    'verifyPayment'
  );
  try {
    const res = await callable({
      orderId: payload.orderId,
      gatewayOrderId: payload.gatewayOrderId,
      gatewayPaymentId: payload.gatewayPaymentId,
      signature: payload.signature,
    });
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Server payment verification failed.'));
  }
}

export async function generatePurchasedQr(
  orderId: string
): Promise<GeneratePurchasedQrResponse> {
  await requireAuthenticatedSession();
  const callable = httpsCallable<{ orderId: string }, GeneratePurchasedQrResponse>(
    functions,
    'generatePurchasedQr'
  );
  try {
    const res = await callable({ orderId });
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to generate order QR artwork.'));
  }
}

export async function adminReconcileOrderPayment(
  payload: AdminReconcileOrderPaymentRequest
): Promise<AdminReconcileOrderPaymentResponse> {
  await requireAuthenticatedSession();
  const callable = httpsCallable<AdminReconcileOrderPaymentRequest, AdminReconcileOrderPaymentResponse>(
    functions,
    'adminReconcileOrderPayment'
  );
  try {
    const res = await callable(payload);
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to reconcile order payment status.'));
  }
}

export async function adminReconcileProfilePayment(
  payload: AdminReconcileProfilePaymentRequest
): Promise<AdminReconcileProfilePaymentResponse> {
  await requireAuthenticatedSession();
  const callable = httpsCallable<AdminReconcileProfilePaymentRequest, AdminReconcileProfilePaymentResponse>(
    functions,
    'adminReconcileProfilePayment'
  );
  try {
    const res = await callable(payload);
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to reconcile profile payment status.'));
  }
}

export async function adminEnsureOrderQr(orderId: string): Promise<QrCodeRecord> {
  await requireAuthenticatedSession();
  const callable = httpsCallable<{ orderId: string }, QrCodeRecord>(
    functions,
    'adminEnsureOrderQr'
  );
  try {
    const res = await callable({ orderId });
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to prepare verified order QR artwork.'));
  }
}

export async function adminSendDesignToPrint(
  payload: AdminSendDesignToPrintRequest
): Promise<AdminSendDesignToPrintResponse> {
  await requireAuthenticatedSession();
  const callable = httpsCallable<AdminSendDesignToPrintRequest, AdminSendDesignToPrintResponse>(
    functions,
    'adminSendDesignToPrint'
  );
  try {
    const res = await callable(payload);
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to route approved design to print.'));
  }
}

export async function generateAdminQr(payload: GenerateAdminQrRequest): Promise<QrCodeRecord> {
  await requireAuthenticatedSession();
  const callable = httpsCallable<GenerateAdminQrRequest, QrCodeRecord>(
    functions,
    'generateAdminQr'
  );
  try {
    const res = await callable(payload);
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to generate Admin QR artwork.'));
  }
}

export async function assignOrderPrinter(
  orderId: string,
  printerId: string
): Promise<{ orderId: string; printerId: string; orderStatus: OrderStatus }> {
  await requireAuthenticatedSession();
  const callable = httpsCallable<
    { orderId: string; printerId: string },
    { orderId: string; printerId: string; orderStatus: OrderStatus }
  >(functions, 'assignPrinter');
  try {
    const res = await callable({ orderId, printerId });
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to assign printer.'));
  }
}

export async function updateServerOrderStatus(
  orderId: string,
  orderStatus: OrderStatus
): Promise<{ orderId: string; orderStatus: OrderStatus }> {
  await requireAuthenticatedSession();
  const callable = httpsCallable<
    { orderId: string; orderStatus: OrderStatus },
    { orderId: string; orderStatus: OrderStatus }
  >(functions, 'updateOrderStatus');
  try {
    const res = await callable({ orderId, orderStatus });
    return res.data;
  } catch (err) {
    throw new Error(extractCallableErrorMessage(err, 'Unable to update order status.'));
  }
}
