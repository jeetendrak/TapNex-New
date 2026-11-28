import type { OrderRecord, OrderStatus } from '../types';
import type { TransactionalEmailResult } from './firestoreService';

export const DISPATCH_SUCCESS_EMAIL_SENT =
  'Dispatch information saved successfully. Customer notification email sent.';
export const DISPATCH_SUCCESS_EMAIL_FAILED =
  'Dispatch information saved successfully, but customer email could not be sent. Please check email configuration or retry.';
export const DISPATCH_SAVE_FAILED =
  'Unable to save dispatch information. Please try again.';

export function formatEmailDeliveryFailureReason(
  emailResult?: Partial<TransactionalEmailResult> | null
): string {
  const err = emailResult?.error?.trim();
  if (err) {
    if (emailResult?.mode === 'unconfigured') {
      return `${err} Set RESEND_API_KEY in Firebase Functions Secrets and redeploy functions.`;
    }
    return err;
  }
  if (emailResult?.mode === 'unconfigured') {
    return 'Resend API key (RESEND_API_KEY) is not configured in Firebase Functions Secrets.';
  }
  if (emailResult?.mode === 'invalid_email') {
    return 'Customer shipping/account email address is missing or invalid.';
  }
  if (emailResult?.mode === 'invalid_sender') {
    return 'RESEND_FROM_EMAIL sender address is invalid.';
  }
  return '';
}

export interface DispatchFormInput {
  orderId: string;
  courierName: string;
  trackingNumber: string;
  trackingUrl?: string;
  dispatchDate: string;
}

export interface SendDispatchEmailPayload {
  orderId: string;
  uid: string;
  to: string;
  templateId: 'dispatched';
  variables: Record<string, string>;
}

export function buildDispatchedEmailVariables(params: {
  orderNumber: string;
  orderId: string;
  customerName: string;
  courierName: string;
  trackingNumber: string;
  trackingUrl?: string;
  dispatchDate: string;
}): Record<string, string> {
  return {
    ORDER_NUMBER: params.orderNumber,
    ORDER_ID: params.orderId,
    CUSTOMER_NAME: params.customerName || 'Valued Customer',
    COURIER_NAME: params.courierName.trim(),
    TRACKING_NUMBER: params.trackingNumber.trim(),
    TRACKING_URL: (params.trackingUrl || '').trim(),
    DISPATCH_DATE: params.dispatchDate.trim(),
  };
}

export function applyDispatchFieldsToOrder(
  order: OrderRecord,
  input: DispatchFormInput
): OrderRecord {
  return {
    ...order,
    orderStatus: 'Dispatched' as OrderStatus,
    courierName: input.courierName.trim(),
    trackingNumber: input.trackingNumber.trim(),
    trackingUrl: (input.trackingUrl || '').trim(),
    dispatchDate: input.dispatchDate.trim(),
  };
}

export interface ExecuteDispatchWithNotificationParams {
  order: OrderRecord;
  input: DispatchFormInput;
  createShippingRecordFn: (payload: DispatchFormInput) => Promise<{ shippingId: string }>;
  sendEmailFn: (payload: SendDispatchEmailPayload) => Promise<TransactionalEmailResult>;
  onDispatchSaved: (updatedOrder: OrderRecord, shippingId: string) => void;
  onEmailSuccess: (message: string, emailResult: TransactionalEmailResult) => void;
  onEmailFailure: (message: string, emailResult: TransactionalEmailResult) => void;
  onSaveFailure: (message: string, error: unknown) => void;
}

export type DispatchExecutionOutcome =
  | {
      case: 'A';
      dispatchSaved: true;
      emailDelivered: true;
      shippingId: string;
      message: string;
      emailResult: TransactionalEmailResult;
    }
  | {
      case: 'B';
      dispatchSaved: true;
      emailDelivered: false;
      shippingId: string;
      message: string;
      emailResult: TransactionalEmailResult;
    }
  | {
      case: 'C';
      dispatchSaved: false;
      emailDelivered: false;
      message: string;
    };

export async function executeDispatchWithNotification(
  params: ExecuteDispatchWithNotificationParams
): Promise<DispatchExecutionOutcome> {
  const cleanInput: DispatchFormInput = {
    orderId: params.input.orderId,
    courierName: params.input.courierName.trim(),
    trackingNumber: params.input.trackingNumber.trim(),
    trackingUrl: (params.input.trackingUrl || '').trim(),
    dispatchDate: params.input.dispatchDate.trim(),
  };

  let shippingId = '';
  try {
    const res = await params.createShippingRecordFn(cleanInput);
    shippingId = res.shippingId;
  } catch (err) {
    params.onSaveFailure(DISPATCH_SAVE_FAILED, err);
    return {
      case: 'C',
      dispatchSaved: false,
      emailDelivered: false,
      message: DISPATCH_SAVE_FAILED,
    };
  }

  const updatedOrder = applyDispatchFieldsToOrder(params.order, cleanInput);
  params.onDispatchSaved(updatedOrder, shippingId);

  let emailResult: TransactionalEmailResult;
  try {
    emailResult = await params.sendEmailFn({
      orderId: updatedOrder.orderId,
      uid: updatedOrder.uid,
      to: updatedOrder.shippingAddress?.email || '',
      templateId: 'dispatched',
      variables: buildDispatchedEmailVariables({
        orderNumber: updatedOrder.orderNumber,
        orderId: updatedOrder.orderId,
        customerName: updatedOrder.shippingAddress?.fullName || 'Valued Customer',
        courierName: cleanInput.courierName,
        trackingNumber: cleanInput.trackingNumber,
        trackingUrl: cleanInput.trackingUrl,
        dispatchDate: cleanInput.dispatchDate,
      }),
    });
  } catch (err) {
    emailResult = {
      delivered: false,
      mode: 'error',
      error: err instanceof Error ? err.message : 'Unable to send customer dispatch email.',
    };
  }

  if (emailResult.delivered === true) {
    params.onEmailSuccess(DISPATCH_SUCCESS_EMAIL_SENT, emailResult);
    return {
      case: 'A',
      dispatchSaved: true,
      emailDelivered: true,
      shippingId,
      message: DISPATCH_SUCCESS_EMAIL_SENT,
      emailResult,
    };
  }

  params.onEmailFailure(DISPATCH_SUCCESS_EMAIL_FAILED, emailResult);
  return {
    case: 'B',
    dispatchSaved: true,
    emailDelivered: false,
    shippingId,
    message: DISPATCH_SUCCESS_EMAIL_FAILED,
    emailResult,
  };
}

export async function executeRetryDispatchEmail(params: {
  order: OrderRecord;
  sendEmailFn: (payload: SendDispatchEmailPayload) => Promise<TransactionalEmailResult>;
  onEmailSuccess: (message: string, emailResult: TransactionalEmailResult) => void;
  onEmailFailure: (message: string, emailResult: TransactionalEmailResult) => void;
}): Promise<{ delivered: boolean; message: string; emailResult: TransactionalEmailResult }> {
  let emailResult: TransactionalEmailResult;
  try {
    emailResult = await params.sendEmailFn({
      orderId: params.order.orderId,
      uid: params.order.uid,
      to: params.order.shippingAddress?.email || '',
      templateId: 'dispatched',
      variables: buildDispatchedEmailVariables({
        orderNumber: params.order.orderNumber,
        orderId: params.order.orderId,
        customerName: params.order.shippingAddress?.fullName || 'Valued Customer',
        courierName: params.order.courierName || '',
        trackingNumber: params.order.trackingNumber || '',
        trackingUrl: params.order.trackingUrl || '',
        dispatchDate: params.order.dispatchDate || new Date().toISOString().slice(0, 10),
      }),
    });
  } catch (err) {
    emailResult = {
      delivered: false,
      mode: 'error',
      error: err instanceof Error ? err.message : 'Unable to send customer dispatch email.',
    };
  }

  if (emailResult.delivered === true) {
    params.onEmailSuccess(DISPATCH_SUCCESS_EMAIL_SENT, emailResult);
    return {
      delivered: true,
      message: DISPATCH_SUCCESS_EMAIL_SENT,
      emailResult,
    };
  }

  params.onEmailFailure(DISPATCH_SUCCESS_EMAIL_FAILED, emailResult);
  return {
    delivered: false,
    message: DISPATCH_SUCCESS_EMAIL_FAILED,
    emailResult,
  };
}
