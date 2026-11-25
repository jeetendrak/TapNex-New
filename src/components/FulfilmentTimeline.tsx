import React from 'react';
import { ArrowRight, CheckCircle2, Printer as PrinterIcon, Truck, AlertTriangle } from 'lucide-react';
import { ORDER_STATUS_FLOW } from '../lib/constants';
import type { OrderStatus } from '../types';

interface FulfilmentTimelineProps {
  currentStatus: OrderStatus;
  interactive?: boolean;
  allowedStatuses?: OrderStatus[];
  updating?: boolean;
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
    if (!interactive || !onSelectStatus || updating) return false;
    if (!allowedStatuses) return true;
    return allowedStatuses.includes(step);
  };

  const handleAdvanceClick = () => {
    if (!nextStep || !onSelectStatus || updating) return;
    if (nextStep === 'Dispatched' && !trackingNumber && onOpenDispatchForm) {
      onOpenDispatchForm();
      return;
    }
    onSelectStatus(nextStep);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
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
              onClick={handleAdvanceClick}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0B1D3A] hover:bg-[#132A52] text-white text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              <span>Advance: {nextStep}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Linear Progress Strip */}
      {!isTerminalException && (
        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
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
          const clickable = canSelectStep(step);

          const baseClass = `p-3 rounded-xl border text-xs flex items-center justify-between gap-2 text-left transition-all ${
            isCurrent
              ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-400/40 text-emerald-950 font-bold'
              : done
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900 font-semibold'
                : 'bg-slate-50 border-slate-200 text-slate-500'
          }`;

          if (clickable) {
            return (
              <button
                key={step}
                type="button"
                disabled={updating}
                onClick={() => {
                  if (step === 'Dispatched' && !trackingNumber && onOpenDispatchForm) {
                    onOpenDispatchForm();
                    return;
                  }
                  onSelectStatus?.(step);
                }}
                title={`Set status to "${step}"`}
                className={`${baseClass} hover:border-[#1D4ED8] hover:shadow-xs cursor-pointer disabled:opacity-60`}
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
              </button>
            );
          }

          return (
            <div key={step} className={baseClass}>
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
    </div>
  );
};
