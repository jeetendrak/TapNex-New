import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FulfilmentTimeline } from '../src/components/FulfilmentTimeline';
import {
  ADMIN_MANUAL_ORDER_STATUS_OPTIONS,
  executeTimelineStatusUpdate,
  sanitizeTimelineErrorMessage,
} from '../src/lib/timelineFeedback';
import type { OrderStatus } from '../src/types';

interface ReactElementLike {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
}

function collectElements(
  node: unknown,
  predicate: (el: ReactElementLike) => boolean,
  acc: ReactElementLike[] = []
): ReactElementLike[] {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') {
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectElements(child, predicate, acc);
    }
    return acc;
  }
  if (typeof node === 'object') {
    const el = node as ReactElementLike;
    if (predicate(el)) {
      acc.push(el);
    }
    if (el.props && el.props.children !== undefined) {
      collectElements(el.props.children, predicate, acc);
    }
  }
  return acc;
}

const PRINTER_ALLOWED_STATUSES: OrderStatus[] = [
  'Processing',
  'Assigned to Printer',
  'Printing in Progress',
  'Quality Check',
  'Ready for Dispatch',
  'Dispatched',
  'In Transit',
  'Delivered',
];

describe('FulfilmentTimeline interaction and feedback', () => {
  it('invokes onSelectStatus with Printing in Progress when Advance button is clicked and clears prior feedback', () => {
    const onSelectStatus = vi.fn();
    const onDismissError = vi.fn();
    const onDismissSuccess = vi.fn();

    const tree = FulfilmentTimeline({
      currentStatus: 'Assigned to Printer',
      interactive: true,
      allowedStatuses: PRINTER_ALLOWED_STATUSES,
      errorMessage: 'Previous transient failure',
      successMessage: 'Previous confirmation',
      onDismissError,
      onDismissSuccess,
      onSelectStatus,
    });

    const advanceButtons = collectElements(
      tree,
      (el) => el.type === 'button' && el.props?.['aria-label'] === 'Advance: Printing in Progress'
    );
    expect(advanceButtons).toHaveLength(1);
    expect(advanceButtons[0].props?.disabled).toBe(false);

    (advanceButtons[0].props?.onClick as () => void)();

    expect(onDismissError).toHaveBeenCalledTimes(1);
    expect(onDismissSuccess).toHaveBeenCalledTimes(1);
    expect(onSelectStatus).toHaveBeenCalledTimes(1);
    expect(onSelectStatus).toHaveBeenCalledWith('Printing in Progress');
  });

  it('invokes onSelectStatus with exact status when clicking individual future milestones', () => {
    const onSelectStatus = vi.fn();

    const tree = FulfilmentTimeline({
      currentStatus: 'Assigned to Printer',
      interactive: true,
      allowedStatuses: PRINTER_ALLOWED_STATUSES,
      onSelectStatus,
    });

    const printingButtons = collectElements(
      tree,
      (el) => el.type === 'button' && el.props?.['aria-label'] === 'Set status to "Printing in Progress"'
    );
    const qualityButtons = collectElements(
      tree,
      (el) => el.type === 'button' && el.props?.['aria-label'] === 'Set status to "Quality Check"'
    );

    expect(printingButtons).toHaveLength(1);
    expect(qualityButtons).toHaveLength(1);

    (printingButtons[0].props?.onClick as () => void)();
    (qualityButtons[0].props?.onClick as () => void)();

    expect(onSelectStatus).toHaveBeenNthCalledWith(1, 'Printing in Progress');
    expect(onSelectStatus).toHaveBeenNthCalledWith(2, 'Quality Check');
  });

  it('opens dispatch form instead of calling onSelectStatus when Dispatched is clicked without tracking info', () => {
    const onSelectStatus = vi.fn();
    const onOpenDispatchForm = vi.fn();
    const onDismissError = vi.fn();

    const tree = FulfilmentTimeline({
      currentStatus: 'Ready for Dispatch',
      interactive: true,
      allowedStatuses: PRINTER_ALLOWED_STATUSES,
      onDismissError,
      onSelectStatus,
      onOpenDispatchForm,
    });

    const advanceDispatch = collectElements(
      tree,
      (el) => el.type === 'button' && el.props?.['aria-label'] === 'Advance: Dispatched'
    );
    const milestoneDispatch = collectElements(
      tree,
      (el) => el.type === 'button' && el.props?.['aria-label'] === 'Set status to "Dispatched"'
    );

    expect(advanceDispatch).toHaveLength(1);
    expect(milestoneDispatch).toHaveLength(1);

    (advanceDispatch[0].props?.onClick as () => void)();
    (milestoneDispatch[0].props?.onClick as () => void)();

    expect(onOpenDispatchForm).toHaveBeenCalledTimes(2);
    expect(onDismissError).toHaveBeenCalledTimes(2);
    expect(onSelectStatus).not.toHaveBeenCalled();
  });

  it('allows selecting Dispatched when trackingNumber already exists', () => {
    const onSelectStatus = vi.fn();
    const onOpenDispatchForm = vi.fn();

    const tree = FulfilmentTimeline({
      currentStatus: 'Ready for Dispatch',
      interactive: true,
      trackingNumber: 'AWB123456',
      allowedStatuses: PRINTER_ALLOWED_STATUSES,
      onSelectStatus,
      onOpenDispatchForm,
    });

    const advanceDispatch = collectElements(
      tree,
      (el) => el.type === 'button' && el.props?.['aria-label'] === 'Advance: Dispatched'
    );
    (advanceDispatch[0].props?.onClick as () => void)();

    expect(onSelectStatus).toHaveBeenCalledWith('Dispatched');
    expect(onOpenDispatchForm).not.toHaveBeenCalled();
  });

  it('disables timeline buttons, shows pending indicator, and blocks duplicate clicks while updating', () => {
    const onSelectStatus = vi.fn();

    const props = {
      currentStatus: 'Assigned to Printer' as OrderStatus,
      interactive: true,
      updating: true,
      pendingStatus: 'Printing in Progress' as OrderStatus,
      allowedStatuses: PRINTER_ALLOWED_STATUSES,
      onSelectStatus,
    };

    const tree = FulfilmentTimeline(props);
    const buttons = collectElements(tree, (el) => el.type === 'button');
    expect(buttons.length).toBeGreaterThan(1);

    for (const btn of buttons) {
      expect(btn.props?.disabled).toBe(true);
      expect(btn.props?.['aria-disabled']).toBe(true);
      (btn.props?.onClick as (() => void) | undefined)?.();
    }
    expect(onSelectStatus).not.toHaveBeenCalled();

    const html = renderToStaticMarkup(<FulfilmentTimeline {...props} />);
    expect(html).toContain('Updating...');
    expect(html).toContain('Updating order status to &quot;Printing in Progress&quot;...');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Current');
  });

  it('renders persistent inline error alert and allows dismissing it', () => {
    const onDismissError = vi.fn();

    const props = {
      currentStatus: 'Assigned to Printer' as OrderStatus,
      interactive: true,
      allowedStatuses: PRINTER_ALLOWED_STATUSES,
      errorMessage: 'This order is not assigned to your active printer facility.',
      onDismissError,
      onSelectStatus: vi.fn(),
    };

    const html = renderToStaticMarkup(<FulfilmentTimeline {...props} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Status update failed');
    expect(html).toContain('This order is not assigned to your active printer facility.');

    const tree = FulfilmentTimeline(props);
    const dismissButtons = collectElements(
      tree,
      (el) => el.type === 'button' && el.props?.['aria-label'] === 'Dismiss status update error'
    );
    expect(dismissButtons).toHaveLength(1);
    (dismissButtons[0].props?.onClick as () => void)();
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it('renders inline success confirmation when update completes without error', () => {
    const onDismissSuccess = vi.fn();
    const html = renderToStaticMarkup(
      <FulfilmentTimeline
        currentStatus="Printing in Progress"
        interactive
        allowedStatuses={PRINTER_ALLOWED_STATUSES}
        successMessage='ORD-1042 updated to "Printing in Progress".'
        onDismissSuccess={onDismissSuccess}
        onSelectStatus={vi.fn()}
      />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('Fulfilment updated');
    expect(html).toContain('ORD-1042 updated to &quot;Printing in Progress&quot;.');
  });
});

describe('timelineFeedback helper & sanitization', () => {
  it('sanitizes backend, stack-trace, URL, and JSON errors into safe user-facing messages', () => {
    expect(
      sanitizeTimelineErrorMessage(
        new Error(
          'FirebaseError: HttpsError: Failed to fetch https://us-central1-app.cloudfunctions.net/updateOrderStatus\n    at callFn (/app/src/index.ts:12:4)'
        )
      )
    ).toBe('Could not reach the order update service right now. Please try again in a moment.');

    expect(
      sanitizeTimelineErrorMessage(new Error('{"error":{"code":500,"detail":"/app/server.ts"}}'))
    ).toBe('Unable to update order status. Please try again.');

    expect(
      sanitizeTimelineErrorMessage(
        new Error('Order cannot move backward or requires printer assigned to its linked Print Auth ID.')
      )
    ).toBe('This order is not assigned to your active printer facility.');

    expect(
      sanitizeTimelineErrorMessage(new Error('HttpsError: User is blocked or disabled. (functions/permission-denied)'))
    ).toBe('Your account does not currently have active permission to update order status.');

    expect(
      sanitizeTimelineErrorMessage(new Error('Order cannot move to Payment Successful here as it affects payment state.'))
    ).toBe('Payment-controlled statuses must be updated via Payment Reconciliation.');
  });

  it('updates state, calls updateServerOrderStatus, refreshes order, and clears loading on success', async () => {
    const events: string[] = [];
    const refreshOrder = vi.fn(async () => {
      events.push('refresh');
    });
    const updateOrderStatusFn = vi.fn(async (orderId: string, orderStatus: OrderStatus) => {
      events.push(`server:${orderId}:${orderStatus}`);
      return { orderId, orderStatus };
    });

    const result = await executeTimelineStatusUpdate({
      orderId: 'ord_123',
      currentStatus: 'Assigned to Printer',
      nextStatus: 'Printing in Progress',
      hasUserSession: true,
      isUpdating: false,
      updateOrderStatusFn,
      onStart: (next) => events.push(`start:${next}`),
      onOptimisticUpdate: (next) => events.push(`optimistic:${next}`),
      onSuccess: async (next) => {
        events.push(`success:${next}`);
        await refreshOrder();
      },
      onError: (msg) => events.push(`error:${msg}`),
      onFinish: () => events.push('finish'),
    });

    expect(result).toEqual({ ok: true });
    expect(updateOrderStatusFn).toHaveBeenCalledWith('ord_123', 'Printing in Progress');
    expect(refreshOrder).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'start:Printing in Progress',
      'server:ord_123:Printing in Progress',
      'optimistic:Printing in Progress',
      'success:Printing in Progress',
      'refresh',
      'finish',
    ]);
  });

  it('catches failed status update, reports sanitized inline error, and still clears loading', async () => {
    const onError = vi.fn();
    const onFinish = vi.fn();
    const onOptimisticUpdate = vi.fn();
    const onSuccess = vi.fn();

    const result = await executeTimelineStatusUpdate({
      orderId: 'ord_123',
      currentStatus: 'Assigned to Printer',
      nextStatus: 'Printing in Progress',
      hasUserSession: true,
      isUpdating: false,
      updateOrderStatusFn: async () => {
        throw new Error('CORS error hitting https://region-proj.cloudfunctions.net/updateOrderStatus\n    at line 10');
      },
      onOptimisticUpdate,
      onSuccess,
      onError,
      onFinish,
    });

    expect(result.ok).toBe(false);
    expect(onOptimisticUpdate).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      'Could not reach the order update service right now. Please try again in a moment.'
    );
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('guards against concurrent updates, missing session, and redundant current status selection', async () => {
    const updateFn = vi.fn();
    const onError = vi.fn();

    const concurrent = await executeTimelineStatusUpdate({
      orderId: 'ord_1',
      currentStatus: 'Processing',
      nextStatus: 'Assigned to Printer',
      hasUserSession: true,
      isUpdating: true,
      updateOrderStatusFn: updateFn,
      onError,
    });
    expect(concurrent).toEqual({ ok: false, ignored: true });

    const unauth = await executeTimelineStatusUpdate({
      orderId: 'ord_1',
      currentStatus: 'Processing',
      nextStatus: 'Assigned to Printer',
      hasUserSession: false,
      isUpdating: false,
      updateOrderStatusFn: updateFn,
      onError,
    });
    expect(unauth.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith('Your session has expired. Please sign in again and retry.');

    const sameStatus = await executeTimelineStatusUpdate({
      orderId: 'ord_1',
      currentStatus: 'Processing',
      nextStatus: 'Processing',
      hasUserSession: true,
      isUpdating: false,
      updateOrderStatusFn: updateFn,
      onError,
    });
    expect(sameStatus).toEqual({ ok: true, ignored: true });
    expect(updateFn).not.toHaveBeenCalled();
  });
});

describe('Admin & Printer portal integration rules', () => {
  it('excludes Payment Successful and Refunded from Admin manual Change Order Status options', () => {
    expect(ADMIN_MANUAL_ORDER_STATUS_OPTIONS).not.toContain('Payment Successful');
    expect(ADMIN_MANUAL_ORDER_STATUS_OPTIONS).not.toContain('Refunded');
    expect(ADMIN_MANUAL_ORDER_STATUS_OPTIONS).toContain('Printing in Progress');
    expect(ADMIN_MANUAL_ORDER_STATUS_OPTIONS).toContain('Delivered');
    expect(ADMIN_MANUAL_ORDER_STATUS_OPTIONS).toContain('Cancelled');
  });

  it('wires AdminOrderDetailPage and PrinterOrderDetailPage to executeTimelineStatusUpdate, inline feedback props, and disabled dispatch submit', () => {
    const printerSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/printer/PrinterPortalPages.tsx'),
      'utf8'
    );
    const adminSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/admin/AdminPortalPages.tsx'),
      'utf8'
    );

    // Printer portal wiring
    expect(printerSrc).toContain('executeTimelineStatusUpdate');
    expect(printerSrc).toContain('updateOrderStatusFn: updateServerOrderStatus');
    expect(printerSrc).toContain('pendingStatus={pendingStepStatus}');
    expect(printerSrc).toContain('errorMessage={timelineError}');
    expect(printerSrc).toContain('successMessage={timelineSuccess}');
    expect(printerSrc).toContain('disabled={updatingStep}');
    expect(printerSrc).toContain("updatingStep ? 'Updating Dispatch...' : 'Confirm Dispatch & Notify Customer'");
    expect(printerSrc).toContain("'Status update failed'");

    // Admin portal wiring (scoped to AdminOrderDetailPage)
    const adminDetailStart = adminSrc.indexOf('export const AdminOrderDetailPage');
    const adminNextExport = adminSrc.indexOf('export const ', adminDetailStart + 30);
    const adminDetailSrc = adminSrc.slice(
      adminDetailStart,
      adminNextExport > adminDetailStart ? adminNextExport : adminSrc.length
    );

    expect(adminDetailSrc).toContain('executeTimelineStatusUpdate');
    expect(adminDetailSrc).toContain('updateOrderStatusFn: updateServerOrderStatus');
    expect(adminDetailSrc).toContain('pendingStatus={pendingWorkflowStatus}');
    expect(adminDetailSrc).toContain('errorMessage={timelineError}');
    expect(adminDetailSrc).toContain('successMessage={timelineSuccess}');
    expect(adminDetailSrc).toContain('ADMIN_MANUAL_ORDER_STATUS_OPTIONS.map');
    expect(adminDetailSrc).not.toContain("[...ORDER_STATUS_FLOW, 'Cancelled', 'Refunded'].map");
    expect(adminDetailSrc).toContain("'Fulfilment update failed'");
  });
});
