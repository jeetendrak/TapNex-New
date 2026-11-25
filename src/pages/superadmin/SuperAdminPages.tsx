import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { QrCode, Download, ShieldCheck, CheckCircle2, AlertTriangle, Trash2, RotateCcw, CreditCard, Settings } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { PaymentGatewaySettingsPanel } from '../../components/PaymentGatewaySettingsPanel';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  getAllQrCodes,
  getAllUsers,
  resetApplicationToFreshBlank,
  saveAdminQrCode,
  saveAppSettings,
  updateUserRoleAndStatus,
  type ApplicationResetResult,
} from '../../lib/firestoreService';
import { ALL_ADMIN_PERMISSIONS, PAYMENT_GATEWAY_ORDER } from '../../lib/constants';
import { downloadBlob } from '../../lib/printPdf';
import { generateHighResQrArtwork } from '../../lib/qrArtwork';
import type { AdminPermission, QrCodeRecord, UserRecord, UserRole } from '../../types';

const SuperAdminRolesHubTabs: React.FC = () => {
  const location = useLocation();
  const tabs = [
    { label: 'Roles & Administrators', to: '/superadmin/roles' },
    { label: 'Admin Permissions Matrix', to: '/superadmin/permissions' },
  ];
  return (
    <div className="mb-5 flex flex-wrap gap-2 bg-white border border-slate-200 rounded-2xl p-2">
      {tabs.map((tab) => {
        const active = location.pathname === tab.to;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
              active
                ? 'bg-[#0B1D3A] text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B1D3A]'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
};

// 1. SuperAdmin Dashboard
export const SuperAdminDashboardPage: React.FC = () => {
  const { appSettings } = useAuth();
  const [health, setHealth] = useState<{
    razorpayMode?: string;
    resendConfigured?: boolean;
    superAdminBootstrapEnabled?: boolean;
  } | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d: { integrations?: { razorpayMode?: string; resendConfigured?: boolean; superAdminBootstrapEnabled?: boolean } }) =>
        setHealth(d.integrations || null)
      )
      .catch(() => null);
  }, []);

  const enabledGateways = PAYMENT_GATEWAY_ORDER.filter(
    (id) => appSettings.paymentGateways?.[id]?.enabled ?? true
  );

  return (
    <PortalLayout portal="superadmin" title="SuperAdmin Command Center">
      <div className="space-y-6">
        <div className="bg-[#071226] text-white rounded-2xl p-6 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold">
              <ShieldCheck className="h-4 w-4" />
              <span>Unrestricted Platform Governance</span>
            </div>
            <h2 className="font-display text-2xl font-bold mt-1">SuperAdmin Control Plane</h2>
            <p className="text-xs text-slate-300 mt-1">
              Manage administrators, RBAC permissions, multi-gateway checkout, direct URL QR generation, pricing, and global feature flags.
            </p>
          </div>
          <Link
            to="/superadmin/system-settings?tab=gateways"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold rounded-xl shrink-0"
          >
            <CreditCard className="h-4 w-4" />
            <span>Configure Payment Gateways</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">Active Payment Gateways</div>
            <div className="mt-1.5 font-display text-lg font-bold text-[#0B1D3A]">
              {enabledGateways.length} / {PAYMENT_GATEWAY_ORDER.length} Enabled
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Razorpay ({health?.razorpayMode === 'live' ? 'Live' : 'Sandbox'}), Cashfree, Easebuzz, PayU, GPay &amp; UPI.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">Transactional Email (Resend)</div>
            <div className="mt-1.5 font-display text-lg font-bold text-[#0B1D3A]">
              {health?.resendConfigured ? 'Connected (Live)' : 'API Key Pending'}
            </div>
            <p className="mt-1 text-xs text-slate-500">Set RESEND_API_KEY in server environment variables to send live emails.</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">Initial Bootstrap Guard</div>
            <div className="mt-1.5 font-display text-lg font-bold text-[#0B1D3A]">
              {health?.superAdminBootstrapEnabled ? 'Enabled (Disable After Init)' : 'Disabled (Secured)'}
            </div>
            <p className="mt-1 text-xs text-slate-500">One-time bootstrap script controlled via SUPERADMIN_BOOTSTRAP_ENABLED.</p>
          </div>
        </div>

        <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-rose-700 text-xs font-bold uppercase tracking-wide">
              <RotateCcw className="h-4 w-4" />
              <span>Workspace Maintenance</span>
            </div>
            <h3 className="font-display text-base font-bold text-[#0B1D3A]">
              Clear All Test Data &amp; Start Fresh Blank
            </h3>
            <p className="text-xs text-slate-600 max-w-2xl">
              Wipe all test orders, payments, designs, QR codes, profiles, support tickets, printers, secondary users, and audit logs to restore a clean, fresh application state.
            </p>
          </div>
          <Link
            to="/superadmin/system-settings#factory-reset"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl shrink-0"
          >
            <Trash2 className="h-4 w-4" />
            <span>Open Factory Reset</span>
          </Link>
        </div>
      </div>
    </PortalLayout>
  );
};

// 2. SuperAdmin Roles Management
export const SuperAdminRolesPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify } = useToast();
  const [users, setUsers] = useState<UserRecord[]>([]);

  const load = () => getAllUsers().then(setUsers);
  useEffect(() => { load(); }, []);

  const handleRoleChange = async (target: UserRecord, newRole: UserRole) => {
    if (!userRecord) return;
    const superAdmins = users.filter((u) => u.role === 'SUPERADMIN' && u.status === 'Active');
    if (target.role === 'SUPERADMIN' && newRole !== 'SUPERADMIN' && superAdmins.length <= 1) {
      notify('Protected', 'Cannot demote the last active SuperAdmin.', 'error');
      return;
    }
    await updateUserRoleAndStatus({
      targetUser: target,
      newRole,
      newStatus: target.status,
      actor: { uid: userRecord.uid, email: userRecord.email, role: 'SUPERADMIN' },
    });
    load();
    notify('Role updated', `${target.email} is now ${newRole}.`, 'success');
  };

  return (
    <PortalLayout portal="superadmin" title="Role & Administrator Control">
      <SuperAdminRolesHubTabs />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-3 px-4">Account</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Assigned Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.uid}>
                <td className="py-3 px-4">
                  <div className="font-semibold text-[#0B1D3A]">{u.displayName || u.email}</div>
                  <div className="text-slate-500">{u.email}</div>
                </td>
                <td className="py-3 px-4">{u.status}</td>
                <td className="py-3 px-4">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u, e.target.value as UserRole)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-xs font-semibold"
                  >
                    <option value="USER">USER</option>
                    <option value="PRINTER">PRINTER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="SUPERADMIN">SUPERADMIN</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PortalLayout>
  );
};

// 3. SuperAdmin Permissions Matrix for ADMINs
export const SuperAdminPermissionsPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify } = useToast();
  const [admins, setAdmins] = useState<UserRecord[]>([]);

  const load = () => getAllUsers().then((all) => setAdmins(all.filter((u) => u.role === 'ADMIN')));
  useEffect(() => { load(); }, []);

  const togglePerm = async (adminUser: UserRecord, perm: AdminPermission) => {
    if (!userRecord) return;
    const current = adminUser.permissions || [];
    const next = current.includes(perm) ? current.filter((p) => p !== perm) : [...current, perm];
    await updateUserRoleAndStatus({
      targetUser: adminUser,
      newRole: 'ADMIN',
      newStatus: adminUser.status,
      permissions: next,
      actor: { uid: userRecord.uid, email: userRecord.email, role: 'SUPERADMIN' },
    });
    load();
    notify('Permissions updated', `Updated permissions for ${adminUser.email}.`, 'success');
  };

  return (
    <PortalLayout portal="superadmin" title="Configurable Admin Permissions">
      <SuperAdminRolesHubTabs />
      {admins.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-600">
          No ADMIN accounts configured yet. Promote a user to ADMIN in Roles & Administrators to configure their permissions.
        </div>
      ) : (
        <div className="space-y-4">
          {admins.map((a) => (
            <div key={a.uid} className="bg-white border border-slate-200 rounded-2xl p-6">
              <div className="font-display font-bold text-base text-[#0B1D3A] mb-3">{a.email}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {ALL_ADMIN_PERMISSIONS.map((perm) => {
                  const enabled = (a.permissions || []).includes(perm.id);
                  return (
                    <label
                      key={perm.id}
                      className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => togglePerm(a, perm.id)}
                        className="mt-0.5 accent-[#1D4ED8]"
                      />
                      <div>
                        <div className="text-xs font-semibold text-[#0B1D3A]">{perm.label}</div>
                        <div className="text-[11px] text-slate-500">{perm.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </PortalLayout>
  );
};

// 4. SuperAdmin Direct Public URL QR Generator
export const SuperAdminQrGeneratorPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify } = useToast();
  const [targetUrl, setTargetUrl] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [orderId, setOrderId] = useState('');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [latestQr, setLatestQr] = useState<QrCodeRecord | null>(null);
  const [history, setHistory] = useState<QrCodeRecord[]>([]);

  const loadHistory = () => getAllQrCodes().then((list) => setHistory(list.filter((q) => q.qrType === 'ADMIN_CUSTOM')));
  useEffect(() => { loadHistory(); }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord) return;
    setGenerating(true);
    try {
      const artwork = await generateHighResQrArtwork(targetUrl, 1024);
      const saved = await saveAdminQrCode({
        targetUrl: artwork.targetUrl,
        svgContent: artwork.svgContent,
        pngDataUrl: artwork.pngDataUrl,
        customerName,
        orderId,
        description,
        actor: { uid: userRecord.uid, email: userRecord.email, role: 'SUPERADMIN' },
      });
      setTargetUrl(artwork.targetUrl);
      setLatestQr(saved);
      loadHistory();
      notify('QR Code generated', `High-resolution PNG & SVG ready for ${artwork.targetUrl}`, 'success');
    } catch (err) {
      notify('Generation failed', err instanceof Error ? err.message : 'Invalid URL', 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <PortalLayout portal="superadmin" title="Generate QR from Any URL">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleGenerate} className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 font-display font-bold text-base text-[#0B1D3A]">
            <QrCode className="h-5 w-5 text-[#1D4ED8]" />
            <span>Direct Public URL QR Generator</span>
          </div>
          <p className="text-xs text-slate-600">
            Generate print-grade QR artwork (Error Correction H + Quiet Zone) for any publicly accessible URL without requiring a customer purchase.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Public URL *</label>
            <input
              type="url"
              required
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://tapnex.in/p/jeet-kulkarni"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Customer Name (Optional)</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Reference / Order Number (Optional)</label>
            <input
              type="text"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={generating}
            className="w-full py-3 bg-[#0B1D3A] text-white text-sm font-semibold rounded-xl disabled:opacity-50"
          >
            {generating ? 'Generating High-Res QR...' : 'Generate QR Code'}
          </button>
        </form>

        <div className="lg:col-span-7 space-y-6">
          {latestQr && latestQr.pngDataUrl && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-6">
              <img src={latestQr.pngDataUrl} alt="Generated QR" className="w-40 h-40 border border-slate-200 rounded-xl" />
              <div className="space-y-3 min-w-0 flex-1">
                <div className="text-xs font-semibold text-emerald-700">Ready for Print & Digital Use</div>
                <div className="text-xs font-mono text-slate-600 break-all">{latestQr.targetUrl}</div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={latestQr.pngDataUrl}
                    download={`${latestQr.qrCodeId}-1024px.png`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0B1D3A] text-white text-xs font-semibold rounded-lg"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download PNG (1024px)</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => downloadBlob(new Blob([latestQr.svgContent], { type: 'image/svg+xml' }), `${latestQr.qrCodeId}.svg`)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-300 text-xs font-semibold rounded-lg"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download SVG Vector</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <h3 className="font-display font-bold text-sm text-[#0B1D3A] mb-3">Saved Custom QR Codes</h3>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">No custom admin QR codes generated yet.</p>
            ) : (
              <div className="space-y-2.5">
                {history.map((item) => (
                  <div key={item.qrCodeId} className="p-3 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#0B1D3A] truncate">{item.customerName || item.targetUrl}</div>
                      <div className="text-[11px] font-mono text-slate-500 truncate">{item.targetUrl}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {item.pngDataUrl && (
                        <a href={item.pngDataUrl} download={`${item.qrCodeId}.png`} className="text-xs font-semibold text-[#1D4ED8]">
                          PNG
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => downloadBlob(new Blob([item.svgContent], { type: 'image/svg+xml' }), `${item.qrCodeId}.svg`)}
                        className="text-xs font-semibold text-[#1D4ED8]"
                      >
                        SVG
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
};

// 5. SuperAdmin Global System Settings
export const SuperAdminSystemSettingsPage: React.FC = () => {
  const { userRecord, appSettings, refreshSettings, refreshSession } = useAuth();
  const { notify } = useToast();
  const location = useLocation();
  const [form, setForm] = useState(appSettings);
  const [saving, setSaving] = useState(false);

  const initialTab = (() => {
    const param = new URLSearchParams(location.search).get('tab');
    if (param === 'gateways') return 'gateways' as const;
    if (param === 'reset' || location.hash === '#factory-reset') return 'reset' as const;
    return 'pricing' as const;
  })();
  const [activeTab, setActiveTab] = useState<'pricing' | 'gateways' | 'reset'>(initialTab);

  const [includeAuditLogs, setIncludeAuditLogs] = useState(true);
  const [restoreDefaultCatalog, setRestoreDefaultCatalog] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<ApplicationResetResult | null>(null);

  useEffect(() => { setForm(appSettings); }, [appSettings]);

  useEffect(() => {
    const param = new URLSearchParams(location.search).get('tab');
    if (param === 'gateways' || param === 'pricing' || param === 'reset') {
      setActiveTab(param);
    } else if (location.hash === '#factory-reset') {
      setActiveTab('reset');
    }
  }, [location.hash, location.search]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord) return;
    setSaving(true);
    try {
      await saveAppSettings(form, { uid: userRecord.uid, email: userRecord.email, role: 'SUPERADMIN' });
      await refreshSettings();
      notify('System settings updated', 'Global pricing, QR privacy, and profile policies saved.', 'success');
    } finally {
      setSaving(false);
    }
  };

  const handleFactoryReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord || confirmText.trim().toUpperCase() !== 'RESET') return;
    setResetting(true);
    setResetResult(null);
    try {
      const result = await resetApplicationToFreshBlank(
        { uid: userRecord.uid, email: userRecord.email, role: 'SUPERADMIN' },
        { includeAuditLogs, restoreDefaultCatalog }
      );
      setResetResult(result);
      setConfirmText('');
      await refreshSettings();
      await refreshSession();
      if (result.errors.length > 0) {
        notify(
          'Reset completed with warnings',
          `Cleared ${result.totalDeleted} database records, with ${result.errors.length} collection error(s).`,
          'error'
        );
      } else {
        notify(
          'Application reset to fresh blank state',
          `Cleared ${result.totalDeleted} Firestore records and ${result.localDraftsCleared} local studio draft(s).`,
          'success'
        );
      }
    } catch (err) {
      notify('Reset failed', err instanceof Error ? err.message : 'Unable to clear application data.', 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <PortalLayout portal="superadmin" title="Payment Gateways & System Settings">
      <div className="mb-6 flex flex-wrap gap-2 bg-white border border-slate-200 rounded-2xl p-2 max-w-4xl">
        <button
          type="button"
          onClick={() => setActiveTab('pricing')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'pricing'
              ? 'bg-[#0B1D3A] text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Settings className="h-3.5 w-3.5" />
          <span>Pricing &amp; Global Policies</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('gateways')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'gateways'
              ? 'bg-[#0B1D3A] text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="h-3.5 w-3.5" />
          <span>Payment Gateways (6 Providers)</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reset')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'reset'
              ? 'bg-rose-600 text-white'
              : 'text-rose-700 hover:bg-rose-50'
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Danger Zone / Factory Reset</span>
        </button>
      </div>

      {activeTab === 'gateways' ? (
        <div className="max-w-4xl">
          <PaymentGatewaySettingsPanel />
        </div>
      ) : activeTab === 'pricing' ? (
        <div className="space-y-8 max-w-3xl">
          <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Company Brand Name</label>
              <input
                type="text"
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Support Email</label>
              <input
                type="email"
                value={form.supportEmail}
                onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Base Card Price (INR)</label>
              <input
                type="number"
                value={form.baseCardPriceInr}
                onChange={(e) => setForm({ ...form, baseCardPriceInr: Number(e.target.value) })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">GST Tax Rate (%)</label>
              <input
                type="number"
                value={form.taxRatePercent}
                onChange={(e) => setForm({ ...form, taxRatePercent: Number(e.target.value) })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">India Shipping Charge (INR)</label>
              <input
                type="number"
                value={form.shippingFeeInr}
                onChange={(e) => setForm({ ...form, shippingFeeInr: Number(e.target.value) })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Deactivated Profile Message</label>
            <input
              type="text"
              value={form.inactiveProfileMessage}
              onChange={(e) => setForm({ ...form, inactiveProfileMessage: e.target.value })}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-100">
            <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 cursor-pointer">
              <div>
                <div className="text-sm font-semibold text-[#0B1D3A]">Enable Multiple Digital Profiles per Account</div>
                <div className="text-xs text-slate-500">Allows customers to create Personal, Business, or Real Estate profiles under one login.</div>
              </div>
              <input
                type="checkbox"
                checked={form.multipleProfilesEnabled}
                onChange={(e) => setForm({ ...form, multipleProfilesEnabled: e.target.checked })}
                className="h-4 w-4 accent-[#1D4ED8]"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 cursor-pointer">
              <div>
                <div className="text-sm font-semibold text-[#0B1D3A]">Allow Customers to View QR Code Post-Purchase</div>
                <div className="text-xs text-slate-500">When disabled, verified QR codes are visible only to Admins and Assigned Printers.</div>
              </div>
              <input
                type="checkbox"
                checked={form.allowCustomerQrView}
                onChange={(e) => setForm({ ...form, allowCustomerQrView: e.target.checked })}
                className="h-4 w-4 accent-[#1D4ED8]"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#0B1D3A] text-white text-sm font-semibold rounded-xl disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>{saving ? 'Saving...' : 'Save Global Settings'}</span>
          </button>
        </form>
        </div>
      ) : (
        <div className="space-y-8 max-w-3xl">
        {/* Danger Zone: Factory Reset */}
        <section
          id="factory-reset"
          className="bg-white border-2 border-rose-200 rounded-2xl p-6 space-y-5"
        >
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-rose-50 text-rose-600 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-rose-900">
                Danger Zone: Clear All Data &amp; Reset App to Fresh Blank
              </h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Permanently deletes all customer orders, Razorpay payment records, QR codes, shipping records, customized card designs, digital profiles, public <code className="font-mono text-[11px]">/p/:slug</code> pages, print partners, support tickets, notifications, secondary user/admin records, and local browser drafts. Your active SuperAdmin account remains signed in with a clean blank workspace.
              </p>
            </div>
          </div>

          <div className="space-y-2.5 pt-2 border-t border-rose-100">
            <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 cursor-pointer">
              <div>
                <div className="text-sm font-semibold text-[#0B1D3A]">Clear All Audit Logs</div>
                <div className="text-xs text-slate-500">Removes all historical audit trail entries so the audit log starts at 0.</div>
              </div>
              <input
                type="checkbox"
                checked={includeAuditLogs}
                onChange={(e) => setIncludeAuditLogs(e.target.checked)}
                className="h-4 w-4 accent-rose-600"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 cursor-pointer">
              <div>
                <div className="text-sm font-semibold text-[#0B1D3A]">Restore Default Card Templates, Email Templates &amp; Pricing</div>
                <div className="text-xs text-slate-500">Deletes any custom test templates and restores clean factory-default templates and INR pricing.</div>
              </div>
              <input
                type="checkbox"
                checked={restoreDefaultCatalog}
                onChange={(e) => setRestoreDefaultCatalog(e.target.checked)}
                className="h-4 w-4 accent-rose-600"
              />
            </label>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
            <strong>Firebase Auth note:</strong> This action wipes all Firestore application data and local studio drafts while preserving your active SuperAdmin session. If you also created separate test email/password logins in Firebase Authentication, delete those accounts from <strong>Firebase Console → Authentication → Users</strong>.
          </div>

          <form onSubmit={handleFactoryReset} className="space-y-3 pt-1">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Type <span className="font-mono text-rose-700">RESET</span> to confirm permanent deletion of all application data
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type RESET"
                className="w-full sm:w-72 px-3.5 py-2.5 border border-rose-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <button
              type="submit"
              disabled={resetting || confirmText.trim().toUpperCase() !== 'RESET'}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              <span>{resetting ? 'Clearing All Application Data...' : 'Clear All Data & Reset App'}</span>
            </button>
          </form>

          {resetResult && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="text-xs font-bold text-[#0B1D3A]">
                Reset Summary: {resetResult.totalDeleted} Firestore document(s) deleted · {resetResult.localDraftsCleared} browser draft(s) cleared
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono text-slate-600">
                {Object.entries(resetResult.deletedCounts).map(([col, count]) => (
                  <div key={col} className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
                    <span>{col}</span>
                    <span className="font-bold text-[#0B1D3A]">{count}</span>
                  </div>
                ))}
              </div>
              {resetResult.errors.length > 0 && (
                <div className="text-xs text-rose-700 space-y-1 pt-1">
                  {resetResult.errors.map((err) => (
                    <div key={err.collection}>
                      {err.collection}: {err.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      )}
    </PortalLayout>
  );
};
