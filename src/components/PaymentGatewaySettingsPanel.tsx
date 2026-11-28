import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  KeyRound,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { PAYMENT_GATEWAY_ORDER } from '../lib/constants';
import { mergePaymentGateways, saveAppSettings } from '../lib/firestoreService';
import type { PaymentGatewayConfig, PaymentGatewayId } from '../types';

export const PaymentGatewaySettingsPanel: React.FC = () => {
  const { userRecord, appSettings, refreshSettings } = useAuth();
  const { notify } = useToast();
  const [draft, setDraft] = useState<Record<PaymentGatewayId, PaymentGatewayConfig>>(() =>
    mergePaymentGateways(appSettings.paymentGateways)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(mergePaymentGateways(appSettings.paymentGateways));
  }, [appSettings.paymentGateways]);

  const updateGateway = (id: PaymentGatewayId, patch: Partial<PaymentGatewayConfig>) => {
    setDraft((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        ...patch,
      },
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord) return;
    setSaving(true);
    try {
      await saveAppSettings(
        { paymentGateways: draft },
        { uid: userRecord.uid, email: userRecord.email, role: userRecord.role }
      );
      await refreshSettings();
      notify(
        'Payment gateway settings updated',
        draft.razorpay.enabled
          ? 'Razorpay checkout is active for customer orders.'
          : 'Razorpay checkout has been disabled.',
        'success'
      );
    } catch (err) {
      notify(
        'Failed to save gateways',
        err instanceof Error ? err.message : 'Unable to save payment gateway settings.',
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-base text-[#18142C] flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-[#7C3AED]" />
              <span>Payment Gateway Control</span>
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Customer Studio and Shop checkouts are exclusively verified by Firebase Cloud Functions using live Razorpay APIs.
            </p>
          </div>
          <span className="px-3 py-1 rounded-lg bg-[#F3EEFF] text-xs font-mono font-semibold text-[#6D28D9] shrink-0">
            Razorpay Only · {draft.razorpay?.enabled ? 'Active' : 'Disabled'}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-xs text-emerald-950">
          <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div>
              <strong>Backend-Managed Credentials:</strong> Razorpay keys (
              <code className="font-mono text-[11px]">RAZORPAY_KEY_ID</code>,{' '}
              <code className="font-mono text-[11px]">RAZORPAY_KEY_SECRET</code>,{' '}
              <code className="font-mono text-[11px]">RAZORPAY_WEBHOOK_SECRET</code>) are stored exclusively in Google Cloud / Firebase Secret Manager on the backend. Browser admins never enter or transmit payment secret keys.
            </div>
            <div className="text-emerald-900/90">
              Non-Razorpay methods (Cashfree, Easebuzz, PayU, Google Pay, Direct UPI) are temporarily unavailable in checkout until independently verified backend integrations are enabled.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PAYMENT_GATEWAY_ORDER.map((id) => {
          const gw = draft[id];
          const isRazorpay = id === 'razorpay';
          const isUpiStyle = id === 'gpay' || id === 'upi';

          return (
            <div
              key={id}
              className={`bg-white border rounded-2xl p-5 space-y-4 transition-colors ${
                isRazorpay && gw.enabled
                  ? 'border-[#7C3AED]/40 shadow-xs'
                  : 'border-[#E9E4F5] opacity-75'
              }`}
            >
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#F0ECF9]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {isUpiStyle ? (
                      <Smartphone className="h-4 w-4 text-slate-500 shrink-0" />
                    ) : (
                      <CreditCard className="h-4 w-4 text-[#7C3AED] shrink-0" />
                    )}
                    <h3 className="font-display font-bold text-sm text-[#18142C]">{gw.label}</h3>
                    {isRazorpay ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-semibold text-emerald-700">
                        <KeyRound className="h-2.5 w-2.5" />
                        <span>Firebase Secret Manager</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-semibold text-slate-600">
                        Temporarily Unavailable
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{gw.description}</p>
                </div>

                <label
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 shrink-0 ${
                    isRazorpay ? 'cursor-pointer hover:bg-slate-100' : 'cursor-not-allowed opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={!isRazorpay}
                    checked={isRazorpay ? gw.enabled : false}
                    onChange={(e) => updateGateway(id, { enabled: e.target.checked })}
                    className="h-4 w-4 accent-[#7C3AED]"
                  />
                  <span className="text-xs font-semibold text-[#18142C]">
                    {isRazorpay ? (gw.enabled ? 'Enabled' : 'Disabled') : 'Unavailable'}
                  </span>
                </label>
              </div>

              {isRazorpay ? (
                <div className="rounded-xl bg-[#FAF9FE] border border-[#E9E4F5] p-3.5 text-xs text-slate-700 space-y-1">
                  <div className="font-semibold text-[#18142C]">Server-Authoritative Flow Active</div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Orders invoke <code className="font-mono">createPaymentOrder</code>, verify signatures and payment capture status via <code className="font-mono">verifyPayment</code>, and reconcile webhooks via <code className="font-mono">razorpayWebhook</code>. Public Key ID is supplied dynamically per order from the backend.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-[11px] text-slate-500">
                  Disabled in customer checkout until server-side payment verification and webhook handlers are configured for this gateway.
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#18142C] hover:bg-[#2A2048] text-white text-sm font-semibold rounded-xl disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          <span>{saving ? 'Saving Gateway Settings...' : 'Save Payment Gateway Settings'}</span>
        </button>
      </div>
    </form>
  );
};
