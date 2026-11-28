import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Printer as PrinterIcon,
  Truck,
  X,
} from 'lucide-react';
import { ORDER_STATUS_FLOW } from '../lib/constants';
import type { OrderStatus } from '../types';

export interface FulfilmentTimelineProps {
  currentStatus: OrderStatus;
  interactive?: boolean;
  allowedStatuses?: OrderStatus[];
  updating?: boolean;
  pendingStatus?: OrderStatus | null;
  errorMessage?: string | null;
  successMessage?: string | null;
  onDismissError?: () => void;
  onDismissSuccess?: () => void;
  onSelectStatus?: (nextStatus: OrderStatus) => Promise<void> | void;
  onOpenDispatchForm?: () => void;
  courierName?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  dispatchDate?: string;
  printerLabel?: string;
}

export const FulfilmentTimeline: React.FC<FulfilmentTimelineProps> = ({
  currentStatus,
  interactive = false,
  allowedStatuses,
  updating = false,
  pendingStatus = null,
  errorMessage = null,
  successMessage = null,
  onDismissError,
  onDismissSuccess,
  onSelectStatus,
  onOpenDispatchForm,
  courierName,
  trackingNumber,
  trackingUrl,
  dispatchDate,
  printerLabel,
}) => {
  const activeIdx = ORDER_STATUS_FLOW.indexOf(currentStatus);
  const isTerminalException = currentStatus === 'Cancelled' || currentStatus === 'Refunded';
  const completedCount = activeIdx >= 0 ? activeIdx + 1 : 0;
  const progressPct = Math.round((completedCount / ORDER_STATUS_FLOW.length) * 100);

  const nextStep =
    activeIdx >= 0 && activeIdx < ORDER_STATUS_FLOW.length - 1
      ? ORDER_STATUS_FLOW[activeIdx + 1]
      : activeIdx === -1 && !isTerminalException
        ? ORDER_STATUS_FLOW[0]
        : null;

  const canSelectStep = (step: OrderStatus) => {
    if (!interactive || !onSelectStatus) return false;
    if (!allowedStatuses) return true;
    return allowedStatuses.includes(step);
  };

  const triggerStatusSelection = (step: OrderStatus) => {
    if (updating || !onSelectStatus) return;
    onDismissError?.();
    onDismissSuccess?.();
    if (step === 'Dispatched' && !trackingNumber && onOpenDispatchForm) {
      onOpenDispatchForm();
      return;
    }
    void onSelectStatus(step);
  };

  const handleAdvanceClick = () => {
    if (!nextStep || !canSelectStep(nextStep) || updating) return;
    triggerStatusSelection(nextStep);
  };

  return (
    <section
      aria-label="Order Fulfilment Timeline"
      aria-busy={updating}
      className="relative bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4"
    >
      {/* Header Row + Progress + Quick Advance */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="font-display font-bold text-sm text-[#0B1D3A]">Fulfilment Timeline</h3>
            {!isTerminalException && (
              <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 tabular-nums">
                Step {Math.max(1, completedCount)} / {ORDER_STATUS_FLOW.length} ({progressPct}%)
              </span>
            )}
            {printerLabel && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-blue-50 text-[#1D4ED8] border border-blue-200">
                <PrinterIcon className="h-3 w-3" />
                <span>{printerLabel}</span>
              </span>
            )}
          </div>
          {interactive && (
            <p className="text-[11px] text-slate-500">
              Click any milestone below or use Advance Step to progress this order through the complete workflow.
            </p>
          )}
        </div>

        {interactive && nextStep && canSelectStep(nextStep) && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={updating}
              aria-disabled={updating}
              aria-label={
                updating
                  ? `Updating order status to ${pendingStatus || nextStep}`
                  : `Advance: ${nextStep}`
              }
              onClick={handleAdvanceClick}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0B1D3A] hover:bg-[#132A52] text-white text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {updating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Updating...</span>
                </>
              ) : (
                <>
                  <span>{`Advance: ${nextStep}`}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Linear Progress Strip */}
      {!isTerminalException && (
        <div
          className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Order fulfilment progress"
        >
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Inline Loading Status */}
      {updating && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-center gap-2.5 text-xs text-[#0B1D3A] font-medium"
        >
          <Loader2 className="h-4 w-4 text-[#1D4ED8] animate-spin shrink-0" />
          <span>
            {pendingStatus
              ? `Updating order status to "${pendingStatus}"...`
              : 'Updating order status...'}
          </span>
        </div>
      )}

      {/* Persistent Inline Error Feedback */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start justify-between gap-3 text-xs text-rose-900"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-semibold">Status update failed</div>
              <p className="mt-0.5 text-rose-800 leading-relaxed">{errorMessage}</p>
            </div>
          </div>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss status update error"
              className="p-1 rounded-lg text-rose-600 hover:bg-rose-100 shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Inline Success Confirmation */}
      {!updating && !errorMessage && successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start justify-between gap-3 text-xs text-emerald-900"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-semibold">Fulfilment updated</div>
              <p className="mt-0.5 text-emerald-800 leading-relaxed">{successMessage}</p>
            </div>
          </div>
          {onDismissSuccess && (
            <button
              type="button"
              onClick={onDismissSuccess}
              aria-label="Dismiss status update confirmation"
              className="p-1 rounded-lg text-emerald-700 hover:bg-emerald-100 shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Cancelled / Refunded Notice */}
      {isTerminalException && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2.5 text-xs text-rose-800 font-semibold">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>Order is currently marked as {currentStatus}. Select a milestone below to resume fulfilment if needed.</span>
        </div>
      )}

      {/* 12-Step Visual Fulfilment Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {ORDER_STATUS_FLOW.map((step, idx) => {
          const done = !isTerminalException && activeIdx >= idx;
          const isCurrent = !isTerminalException && activeIdx === idx;
          const isPendingTarget = updating && pendingStatus === step;
          const clickable = canSelectStep(step);

          const baseClass = `p-3 rounded-xl border text-xs flex items-center justify-between gap-2 text-left transition-all ${
            isCurrent
              ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-400/40 text-emerald-950 font-bold shadow-xs'
              : done
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900 font-semibold'
                : 'bg-slate-50 border-slate-200 text-slate-600'
          }`;

          if (clickable && !isCurrent) {
            return (
              <button
                key={step}
                type="button"
                disabled={updating}
                aria-disabled={updating}
                aria-label={`Set status to "${step}"`}
                onClick={() => triggerStatusSelection(step)}
                title={`Set status to "${step}"`}
                className={`${baseClass} hover:border-[#1D4ED8] hover:shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  {isPendingTarget ? (
                    <Loader2 className="h-4 w-4 shrink-0 text-[#1D4ED8] animate-spin" />
                  ) : (
                    <CheckCircle2 className={`h-4 w-4 shrink-0 ${done ? 'text-emerald-600' : 'text-slate-300'}`} />
                  )}
                  <span className="truncate">{step}</span>
                </span>
              </button>
            );
          }

          return (
            <div
              key={step}
              aria-current={isCurrent ? 'step' : undefined}
              className={baseClass}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <CheckCircle2 className={`h-4 w-4 shrink-0 ${done ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span className="truncate">{step}</span>
              </span>
              {isCurrent && (
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0">
                  Current
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Inline Dispatch / Tracking Summary */}
      {trackingNumber && (
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-700">
            <Truck className="h-4 w-4 text-[#1D4ED8] shrink-0" />
            <span>
              <strong>{courierName || 'Courier'}</strong> · Tracking:{' '}
              <span className="font-mono font-semibold text-[#0B1D3A]">{trackingNumber}</span>
              {dispatchDate ? ` · Dispatched ${dispatchDate}` : ''}
            </span>
          </div>
          {trackingUrl && (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1D4ED8] font-semibold hover:underline"
            >
              Track Shipment →
            </a>
          )}
        </div>
      )}
    </section>
  );
};
