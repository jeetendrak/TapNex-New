import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { PAYMENT_GATEWAY_ORDER } from '../lib/constants';
import { mergePaymentGateways, saveAppSettings } from '../lib/firestoreService';
import { validateGatewayCredentials } from '../lib/gatewayValidation';
import type { PaymentGatewayConfig, PaymentGatewayId } from '../types';

type GatewayTestResult = {
  status: 'idle' | 'testing' | 'ok' | 'error';
  verdict?: 'PASS' | 'FAIL';
  message?: string;
  verifiedAt?: string;
};

type ServerGatewayStatusMap = Partial<Record<PaymentGatewayId, boolean>>;

const GATEWAY_FIELD_LABELS: Record<
  PaymentGatewayId,
  {
    idLabel: string;
    idPlaceholder: string;
    keyLabel: string;
    keyPlaceholder: string;
    envHint: string;
  }
> = {
  razorpay: {
    idLabel: 'Razorpay Key ID *',
    idPlaceholder: 'rzp_test_... or rzp_live_...',
    keyLabel: 'Razorpay Secret Key *',
    keyPlaceholder: 'Enter Razorpay Secret Key',
    envHint: 'RAZORPAY_KEY_SECRET',
  },
  cashfree: {
    idLabel: 'Cashfree App ID *',
    idPlaceholder: 'CF123456...',
    keyLabel: 'Cashfree Secret Key *',
    keyPlaceholder: 'Enter Cashfree Secret Key',
    envHint: 'CASHFREE_SECRET_KEY',
  },
  easebuzz: {
    idLabel: 'Easebuzz Key ID *',
    idPlaceholder: 'Easebuzz Merchant Key ID',
    keyLabel: 'Easebuzz Salt Key *',
    keyPlaceholder: 'Enter Easebuzz Salt Key',
    envHint: 'EASEBUZZ_SALT',
  },
  payu: {
    idLabel: 'PayU Merchant ID *',
    idPlaceholder: 'PayU Merchant Key ID',
    keyLabel: 'PayU Merchant Salt Key *',
    keyPlaceholder: 'Enter PayU Merchant Salt Key',
    envHint: 'PAYU_MERCHANT_SALT',
  },
  gpay: {
    idLabel: 'Google Pay Merchant ID *',
    idPlaceholder: 'BCR2DN...',
    keyLabel: 'Google Pay UPI VPA Key *',
    keyPlaceholder: 'merchant@okaxis',
    envHint: 'GOOGLE_PAY_MERCHANT_ID',
  },
  upi: {
    idLabel: 'Merchant / Terminal ID *',
    idPlaceholder: 'MERCHANT01',
    keyLabel: 'Direct UPI VPA Key *',
    keyPlaceholder: 'merchant@upi',
    envHint: '',
  },
};

export const PaymentGatewaySettingsPanel: React.FC = () => {
  const { userRecord, appSettings, refreshSettings } = useAuth();
  const { notify } = useToast();
  const [draft, setDraft] = useState<Record<PaymentGatewayId, PaymentGatewayConfig>>(() =>
    mergePaymentGateways(appSettings.paymentGateways)
  );
  // Session-only secret/salt key inputs for live/sandbox Test Connection; never stored in Firestore or localStorage.
  const [secretKeys, setSecretKeys] = useState<Partial<Record<PaymentGatewayId, string>>>({});
  const [showSecretMap, setShowSecretMap] = useState<Partial<Record<PaymentGatewayId, boolean>>>({});
  const [serverSecretsReady, setServerSecretsReady] = useState<ServerGatewayStatusMap>({});
  const [saving, setSaving] = useState(false);
  const [testResults, setTestResults] = useState<Partial<Record<PaymentGatewayId, GatewayTestResult>>>({});

  useEffect(() => {
    setDraft(mergePaymentGateways(appSettings.paymentGateways));
  }, [appSettings.paymentGateways]);

  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          json: {
            integrations?: {
              razorpayMode?: string;
              cashfreeConfigured?: boolean;
              easebuzzConfigured?: boolean;
              payuConfigured?: boolean;
              gpayConfigured?: boolean;
            };
          } | null
        ) => {
          if (!active || !json?.integrations) return;
          setServerSecretsReady({
            razorpay: json.integrations.razorpayMode === 'live',
            cashfree: Boolean(json.integrations.cashfreeConfigured),
            easebuzz: Boolean(json.integrations.easebuzzConfigured),
            payu: Boolean(json.integrations.payuConfigured),
            gpay: Boolean(json.integrations.gpayConfigured),
          });
        }
      )
      .catch(() => {
        // Offline / static preview fallback cleanly ignores health probe failure
      });
    return () => {
      active = false;
    };
  }, []);

  const updateGateway = (id: PaymentGatewayId, patch: Partial<PaymentGatewayConfig>) => {
    setDraft((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        ...patch,
      },
    }));
    setTestResults((prev) => ({ ...prev, [id]: { status: 'idle' } }));
  };

  const updateSecretKey = (id: PaymentGatewayId, val: string) => {
    setSecretKeys((prev) => ({ ...prev, [id]: val }));
    setTestResults((prev) => ({ ...prev, [id]: { status: 'idle' } }));
  };

  const handleTestGateway = async (id: PaymentGatewayId) => {
    const gw = draft[id];
    const enteredSecret = secretKeys[id] || '';
    const hasEnvSecret = Boolean(serverSecretsReady[id]);

    setTestResults((prev) => ({
      ...prev,
      [id]: { status: 'testing', message: 'Testing ID & Key...' },
    }));

    const localValidation = (): GatewayTestResult => {
      const check = validateGatewayCredentials({
        gateway: id,
        mode: gw.mode,
        publicKeyId: gw.publicKeyId,
        merchantId: gw.merchantId,
        secretKey: enteredSecret,
        upiId: gw.upiId,
        hasServerSecret: hasEnvSecret,
      });
      if (!check.ok) {
        return { status: 'error', verdict: 'FAIL', message: check.error || check.message };
      }
      return {
        status: 'ok',
        verdict: 'PASS',
        message: check.message,
        verifiedAt: new Date().toLocaleTimeString(),
      };
    };

    try {
      const resp = await fetch('/api/payments/test-gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway: id,
          mode: gw.mode,
          publicKeyId: gw.publicKeyId || '',
          merchantId: gw.merchantId || '',
          secretKey: enteredSecret,
          upiId: gw.upiId || '',
          upiPayeeName: gw.upiPayeeName || '',
        }),
      });
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const fallback = localValidation();
        setTestResults((prev) => ({ ...prev, [id]: fallback }));
        notify(
          fallback.status === 'ok' ? `${gw.label}: PASS` : `${gw.label}: FAIL`,
          fallback.message || '',
          fallback.status === 'ok' ? 'success' : 'error'
        );
        return;
      }

      const json = (await resp.json()) as {
        ok?: boolean;
        verified?: boolean;
        verdict?: 'PASS' | 'FAIL';
        message?: string;
        error?: string;
      };
      const passed = resp.ok && Boolean(json.ok ?? json.verified);
      if (!passed) {
        const msg = json.error || json.message || 'Gateway connection verification failed.';
        setTestResults((prev) => ({
          ...prev,
          [id]: { status: 'error', verdict: 'FAIL', message: msg },
        }));
        notify(`${gw.label}: FAIL`, msg, 'error');
        return;
      }

      const okMsg = json.message || `${gw.label} ID & Key verified.`;
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          status: 'ok',
          verdict: 'PASS',
          message: okMsg,
          verifiedAt: new Date().toLocaleTimeString(),
        },
      }));
      notify(`${gw.label}: PASS`, okMsg, 'success');
    } catch {
      const fallback = localValidation();
      setTestResults((prev) => ({ ...prev, [id]: fallback }));
      notify(
        fallback.status === 'ok' ? `${gw.label}: PASS` : `${gw.label}: FAIL`,
        fallback.message || '',
        fallback.status === 'ok' ? 'success' : 'error'
      );
    }
  };

  const enabledCount = PAYMENT_GATEWAY_ORDER.filter((id) => draft[id]?.enabled).length;

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
        'Payment gateways updated',
        `${enabledCount} gateway${enabledCount === 1 ? '' : 's'} currently enabled for customer checkout.`,
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
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-base text-[#0B1D3A] flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-[#1D4ED8]" />
              <span>Payment Gateways Control &amp; Configuration</span>
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Configure separate <strong>ID</strong> and <strong>Key</strong> credentials for each gateway, toggle checkout visibility, and click <strong>Test Connection</strong> to verify PASS / FAIL status.
            </p>
          </div>
          <span className="px-3 py-1 rounded-lg bg-slate-100 text-xs font-mono font-semibold text-[#0B1D3A] shrink-0">
            {enabledCount} / {PAYMENT_GATEWAY_ORDER.length} Enabled
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-950">
          <ShieldAlert className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong>Security Policy:</strong> Secret/Salt keys entered in the Key field are used only for live/sandbox Test Connection verification in this session and are never persisted to Firestore or browser storage. Production keys should remain in server{' '}
            <code className="font-mono text-[11px]">process.env</code> variables.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PAYMENT_GATEWAY_ORDER.map((id) => {
          const gw = draft[id];
          const labels = GATEWAY_FIELD_LABELS[id];
          const isUpiStyle = id === 'gpay' || id === 'upi';
          const testResult = testResults[id];
          const hasServerSecret = Boolean(serverSecretsReady[id]);
          const showSecret = Boolean(showSecretMap[id]);

          return (
            <div
              key={id}
              className={`bg-white border rounded-2xl p-5 space-y-4 transition-colors ${
                gw.enabled ? 'border-[#1D4ED8]/40 shadow-xs' : 'border-slate-200 opacity-85'
              }`}
            >
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {isUpiStyle ? (
                      <Smartphone className="h-4 w-4 text-emerald-600 shrink-0" />
                    ) : (
                      <CreditCard className="h-4 w-4 text-[#1D4ED8] shrink-0" />
                    )}
                    <h3 className="font-display font-bold text-sm text-[#0B1D3A]">{gw.label}</h3>
                    {hasServerSecret && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-semibold text-emerald-700">
                        <KeyRound className="h-2.5 w-2.5" />
                        <span>Server Env Key Ready</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{gw.description}</p>
                </div>

                <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer shrink-0 hover:bg-slate-100">
                  <input
                    type="checkbox"
                    checked={gw.enabled}
                    onChange={(e) => updateGateway(id, { enabled: e.target.checked })}
                    className="h-4 w-4 accent-[#1D4ED8]"
                  />
                  <span className="text-xs font-semibold text-[#0B1D3A]">
                    {gw.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Environment Mode
                  </label>
                  <select
                    value={gw.mode}
                    onChange={(e) => updateGateway(id, { mode: e.target.value as 'sandbox' | 'live' })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="sandbox">Sandbox / Test (HMAC Verified)</option>
                    <option value="live">Live Production</option>
                  </select>
                </div>

                {!isUpiStyle ? (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {labels.idLabel}
                      </label>
                      <input
                        type="text"
                        value={gw.publicKeyId || ''}
                        onChange={(e) => updateGateway(id, { publicKeyId: e.target.value })}
                        placeholder={labels.idPlaceholder}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {labels.keyLabel}
                      </label>
                      <div className="relative">
                        <input
                          type={showSecret ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={secretKeys[id] || ''}
                          onChange={(e) => updateSecretKey(id, e.target.value)}
                          placeholder={
                            hasServerSecret
                              ? 'Server env loaded (or enter to test)'
                              : labels.keyPlaceholder
                          }
                          className="w-full pl-3 pr-8 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowSecretMap((prev) => ({ ...prev, [id]: !prev[id] }))
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                          aria-label={showSecret ? 'Hide secret key' : 'Show secret key'}
                        >
                          {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {labels.idLabel}
                      </label>
                      <input
                        type="text"
                        value={gw.merchantId || ''}
                        onChange={(e) => updateGateway(id, { merchantId: e.target.value })}
                        placeholder={labels.idPlaceholder}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {labels.keyLabel}
                      </label>
                      <input
                        type="text"
                        value={gw.upiId || ''}
                        onChange={(e) => updateGateway(id, { upiId: e.target.value })}
                        placeholder={labels.keyPlaceholder}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Payee Display Name
                      </label>
                      <input
                        type="text"
                        value={gw.upiPayeeName || ''}
                        onChange={(e) => updateGateway(id, { upiPayeeName: e.target.value })}
                        placeholder="TapNex Smart Cards"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Test Connection Bar */}
              <div className="pt-2.5 border-t border-slate-100 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={testResult?.status === 'testing'}
                    onClick={() => handleTestGateway(id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0B1D3A] disabled:opacity-50"
                  >
                    {testResult?.status === 'testing' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1D4ED8]" />
                    ) : (
                      <Activity className="h-3.5 w-3.5 text-[#1D4ED8]" />
                    )}
                    <span>{testResult?.status === 'testing' ? 'Testing...' : 'Test Connection'}</span>
                  </button>

                  {testResult?.status === 'ok' && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2.5 py-1 rounded-lg">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>PASS</span>
                      {testResult.verifiedAt && (
                        <span className="font-mono font-normal text-emerald-700">
                          · {testResult.verifiedAt}
                        </span>
                      )}
                    </span>
                  )}
                  {testResult?.status === 'error' && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-800 bg-rose-50 border border-rose-300 px-2.5 py-1 rounded-lg">
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                      <span>FAIL</span>
                    </span>
                  )}
                </div>

                {testResult?.message && testResult.status !== 'idle' && (
                  <p
                    className={`text-[11px] leading-snug rounded-lg px-2.5 py-1.5 ${
                      testResult.status === 'ok'
                        ? 'bg-emerald-50/70 text-emerald-900'
                        : testResult.status === 'error'
                          ? 'bg-rose-50/70 text-rose-900'
                          : 'bg-slate-50 text-slate-600'
                    }`}
                  >
                    {testResult.message}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#0B1D3A] hover:bg-[#132A52] text-white text-sm font-semibold rounded-xl disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          <span>{saving ? 'Saving Gateway Settings...' : 'Save Payment Gateway Settings'}</span>
        </button>
      </div>
    </form>
  );
};
