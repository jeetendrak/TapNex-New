import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Download,
  Plus,
  Search,
  Trash2,
  Printer as PrinterIcon,
  ExternalLink,
  Power,
  Pencil,
  Filter,
  RotateCcw,
  X,
  RefreshCw,
  Upload,
  Image as ImageIcon,
  Sparkles,
  Send,
  CheckCircle2,
  Truck,
  QrCode,
  FileText,
  ArrowRight,
  Eye,
  ShieldCheck,
  CreditCard,
  Star,
  CheckSquare,
} from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { CardCanvasPreview } from '../../components/CardCanvasPreview';
import { TemplateVisualEditorModal } from '../../components/TemplateVisualEditorModal';
import { FulfilmentTimeline } from '../../components/FulfilmentTimeline';
import { PaymentGatewaySettingsPanel } from '../../components/PaymentGatewaySettingsPanel';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  adminSetProfileApproval,
  adminToggleProfileStatus,
  createManagedUserRecord,
  deleteCardDesign,
  deleteCardTemplate,
  deleteDigitalProfile,
  dispatchOrderWithCourier,
  filterAuditLogs,
  formatTimestampDate,
  getAllCardDesigns,
  getAllOrders,
  getAllPayments,
  getAllPrinters,
  getAllProfiles,
  getAllQrCodes,
  getAllShippingRecords,
  getAllUsers,
  getAuditLogs,
  getCardDesignById,
  getCardTemplates,
  getEmailTemplates,
  getOrderById,
  getProfileById,
  getQrCodeById,
  getSupportTickets,
  getUserById,
  getUserProfiles,
  isOrderPaymentConfirmed,
  saveCardTemplate,
  saveEmailTemplate,
  savePrinterRecord,
  sendAndLogTransactionalEmail,
  setBulkCardTemplatesVisibility,
  setDefaultCardTemplate,
  updateOrderWorkflow,
  updateSupportTicket,
  updateUserRoleAndStatus,
  type AuditLogPreset,
} from '../../lib/firestoreService';
import {
  adminEnsureOrderQr,
  adminReconcileOrderPayment,
  adminReconcileProfilePayment,
  adminSendDesignToPrint,
  assignOrderPrinter,
  linkPrinterAccount,
} from '../../lib/paymentApi';
import { sanitizeRichBioHtml } from '../../lib/richText';
import { exportRowsToCsv, exportRowsToExcel } from '../../lib/exportUtils';
import { downloadBlob, generateCardSidePngBlob, generatePrintReadyPdfBlob } from '../../lib/printPdf';
import { compressImageFileToDataUrl, generatePrinterAuthId } from '../../lib/qrArtwork';
import { resolveCardPricing } from '../../lib/pricing';
import {
  DEFAULT_CARD_TEMPLATES,
  INDIAN_STATES,
  ORDER_STATUS_FLOW,
  PROFILE_TYPE_OPTIONS,
} from '../../lib/constants';
import type {
  AuditLogRecord,
  CardDesignRecord,
  CardTemplateRecord,
  EmailTemplateRecord,
  OrderRecord,
  OrderStatus,
  PaymentRecord,
  PaymentStatus,
  PersonalInformation,
  PrinterRecord,
  ProfileRecord,
  ProfileType,
  QrCodeRecord,
  ShippingAddress,
  ShippingRecord,
  SupportTicketRecord,
  UserRecord,
  UserRole,
  UserStatus,
} from '../../types';

const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = ['Pending', 'Completed', 'Verified', 'Rejected', 'Failed', 'Refunded'];

const CHART_COLORS = ['#0B1D3A', '#1D4ED8', '#06B6D4', '#16A34A', '#D97706', '#64748B'];

const AdminHubTabBar: React.FC<{ tabs: { label: string; to: string }[] }> = ({ tabs }) => {
  const location = useLocation();
  return (
    <div className="mb-5 flex flex-wrap gap-2 bg-white border border-slate-200 rounded-2xl p-2">
      {tabs.map((tab) => {
        const active =
          location.pathname === tab.to ||
          (tab.to !== '/admin/orders' && location.pathname.startsWith(`${tab.to}/`)) ||
          (tab.to === '/admin/orders' && location.pathname.startsWith('/admin/orders'));
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

const AdminUsersHubTabs = () => (
  <AdminHubTabBar
    tabs={[
      { label: 'Users & Customers', to: '/admin/users' },
      { label: 'Digital Profiles & Approvals', to: '/admin/profiles' },
      { label: 'Print Partners', to: '/admin/printers' },
    ]}
  />
);

const AdminCardsHubTabs = () => (
  <AdminHubTabBar
    tabs={[
      { label: 'Card Templates', to: '/admin/card-designs' },
      { label: 'Approved Designs & Print', to: '/admin/approved-designs' },
    ]}
  />
);

const AdminOrdersHubTabs = () => (
  <AdminHubTabBar
    tabs={[
      { label: 'Orders & Status', to: '/admin/orders' },
      { label: 'Payment Transactions', to: '/admin/payments' },
      { label: 'Shipping & Dispatch', to: '/admin/shipping' },
    ]}
  />
);

const AdminOpsHubTabs = () => (
  <AdminHubTabBar
    tabs={[
      { label: 'Gateways, Support & Email', to: '/admin/settings' },
      { label: 'QR Management', to: '/admin/qr-management' },
      { label: 'Reports & Export', to: '/admin/reports' },
      { label: 'Audit Logs', to: '/admin/audit-logs' },
    ]}
  />
);

const AdminProfileInspectorModal: React.FC<{
  profile: ProfileRecord;
  owner?: UserRecord | null;
  paid: boolean;
  onClose: () => void;
  onToggleApproval: (profile: ProfileRecord) => Promise<void>;
  onToggleActive: (profile: ProfileRecord) => Promise<void>;
  onMarkPaymentCompleted: (profile: ProfileRecord, completed: boolean) => Promise<void>;
}> = ({ profile, owner, paid, onClose, onToggleApproval, onToggleActive, onMarkPaymentCompleted }) => {
  const [busy, setBusy] = useState(false);
  const info = profile.personalInformation || ({} as PersonalInformation);
  const vis = profile.visibilitySettings;
  const pType: ProfileType = profile.profileType || 'adult';
  const pTypeMeta = PROFILE_TYPE_OPTIONS.find((t) => t.id === pType) || PROFILE_TYPE_OPTIONS[0];

  const detailRows: { label: string; value?: string; visible: boolean }[] =
    pType === 'kids'
      ? [
          { label: "Child's Name", value: info.fullName, visible: vis.fullName },
          { label: 'Parent / Guardian', value: info.parentName, visible: Boolean(vis.parentContact) },
          { label: 'Parent Mobile', value: info.parentMobile || info.mobile, visible: Boolean(vis.parentContact || vis.mobile) },
          { label: 'Emergency Helpline', value: [info.emergencyContactName, info.emergencyContactPhone].filter(Boolean).join(' · '), visible: Boolean(vis.emergencyContact) },
          { label: 'School / Class', value: info.schoolOrClass, visible: Boolean(vis.schoolOrClass) },
          { label: 'Blood Group', value: info.bloodGroup, visible: Boolean(vis.bloodGroup) },
          { label: 'Date of Birth', value: info.dateOfBirth, visible: Boolean(vis.dateOfBirth) },
          { label: 'Allergies / Medical Notes', value: info.allergiesOrMedical, visible: Boolean(vis.medicalInfo) },
          { label: 'Home Address', value: info.personalAddress, visible: Boolean(vis.personalAddress) },
          { label: 'City / State / PIN', value: [info.city, info.state, info.pinCode, info.country].filter(Boolean).join(', '), visible: Boolean(vis.personalAddress) },
        ]
      : pType === 'pets'
        ? [
            { label: 'Pet Name', value: info.fullName, visible: vis.fullName },
            { label: 'Pet Type', value: info.petType, visible: Boolean(vis.petDetails) },
            { label: 'Breed', value: info.breed, visible: Boolean(vis.petDetails) },
            { label: 'Gender / Color', value: [info.petGender, info.petColor].filter(Boolean).join(' · '), visible: Boolean(vis.petDetails) },
            { label: 'Microchip / Tag ID', value: info.microchipId, visible: Boolean(vis.petDetails) },
            { label: 'Owner Name', value: info.ownerName, visible: Boolean(vis.ownerContact) },
            { label: 'Owner Mobile', value: info.ownerMobile || info.mobile, visible: Boolean(vis.ownerContact || vis.mobile) },
            { label: 'Veterinarian', value: [info.vetName, info.vetPhone].filter(Boolean).join(' · '), visible: Boolean(vis.vetContact) },
            { label: 'Diet / Medical Notes', value: info.allergiesOrMedical, visible: Boolean(vis.medicalInfo) },
            { label: 'Home Address', value: info.personalAddress, visible: Boolean(vis.personalAddress) },
          ]
        : pType === 'belongings'
          ? [
              { label: 'Item / Owner Label', value: info.fullName, visible: vis.fullName },
              {
                label: 'Item Category',
                value:
                  info.itemCategory === 'Other' && info.itemCategoryOther?.trim()
                    ? `Other (${info.itemCategoryOther.trim()})`
                    : info.itemCategory,
                visible: Boolean(vis.itemDetails),
              },
              { label: 'Brand & Model', value: info.brandModel, visible: Boolean(vis.itemDetails) },
              { label: 'Serial / Tag Reference', value: info.serialNumber, visible: Boolean(vis.itemDetails) },
              { label: 'Owner Mobile', value: info.mobile, visible: vis.mobile },
              { label: 'WhatsApp', value: info.whatsapp, visible: vis.whatsapp },
              { label: 'Email', value: info.email, visible: vis.email },
              { label: 'Finder Notes', value: info.finderNotes, visible: Boolean(vis.finderNotes) },
              { label: 'Return Address', value: info.personalAddress, visible: Boolean(vis.personalAddress) },
              { label: 'City / State / PIN', value: [info.city, info.state, info.pinCode, info.country].filter(Boolean).join(', '), visible: Boolean(vis.personalAddress) },
            ]
          : [
              { label: 'Full Name', value: info.fullName, visible: vis.fullName },
              { label: 'Job Title', value: info.jobTitle, visible: vis.jobTitle },
              { label: 'Company', value: info.companyName, visible: vis.companyName },
              { label: 'Category', value: info.businessCategory, visible: vis.businessCategory },
              { label: 'Mobile', value: info.mobile, visible: vis.mobile },
              { label: 'Alternate Mobile', value: info.alternateMobile, visible: vis.alternateMobile },
              { label: 'WhatsApp', value: info.whatsapp, visible: vis.whatsapp },
              { label: 'Email', value: info.email, visible: vis.email },
              { label: 'Alternate Email', value: info.alternateEmail, visible: vis.alternateEmail },
              { label: 'Website', value: info.website, visible: vis.website },
              { label: 'Blood Group', value: info.bloodGroup, visible: Boolean(vis.bloodGroup) },
              { label: 'Emergency Contact', value: [info.emergencyContactName, info.emergencyContactPhone].filter(Boolean).join(' · '), visible: Boolean(vis.emergencyContact) },
              { label: 'Aadhaar (Optional)', value: info.aadhaarNumber, visible: Boolean(vis.aadhaarNumber) },
              { label: 'PAN (Optional)', value: info.panNumber, visible: Boolean(vis.panNumber) },
              { label: 'Business Address', value: info.businessAddress, visible: vis.businessAddress },
              { label: 'Personal Address', value: info.personalAddress, visible: Boolean(vis.personalAddress) },
              {
                label: 'City / State / PIN',
                value: [info.city, info.state, info.pinCode, info.country].filter(Boolean).join(', '),
                visible: vis.businessAddress,
              },
            ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden my-auto">
        <div className="px-6 py-4 bg-[#0B1D3A] text-white flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-cyan-300">/p/{profile.slug}</div>
            <h3 className="font-display font-bold text-base truncate">
              {info.fullName || profile.profileLabel || profile.slug}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-3">
              {info.photoDataUrl ? (
                <img
                  src={info.photoDataUrl}
                  alt={info.fullName || profile.slug}
                  className="w-14 h-14 rounded-full object-cover border border-slate-200"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-[#0B1D3A] text-white flex items-center justify-center font-bold text-lg">
                  {(info.fullName || profile.slug || 'U').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <div className="text-sm font-bold text-[#0B1D3A]">
                  {profile.profileLabel || 'Digital Profile'}
                </div>
                <div className="text-xs text-slate-500">
                  Owner: {owner?.email || profile.uid} · Template: {profile.selectedTemplate}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200">
                    {pTypeMeta.label}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      paid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {paid ? 'Payment Confirmed' : 'Payment Pending'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      profile.adminApproved
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {profile.adminApproved ? 'Admin Approved (Live Link Active)' : 'Not Admin Approved'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      profile.isPublic && !profile.adminDisabled
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {profile.adminDisabled
                      ? 'Disabled by Admin'
                      : profile.isPublic
                        ? 'Public Enabled'
                        : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={`/p/${profile.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0B1D3A] text-white text-xs font-semibold rounded-lg"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open Public Profile</span>
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onMarkPaymentCompleted(profile, !profile.paymentConfirmed);
                  } finally {
                    setBusy(false);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg disabled:opacity-50 ${
                  profile.paymentConfirmed
                    ? 'border border-amber-300 bg-amber-50 text-amber-900'
                    : 'bg-[#1D4ED8] hover:bg-blue-700 text-white'
                }`}
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span>
                  {profile.paymentConfirmed ? 'Clear Payment Completed' : 'Mark Payment Completed'}
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onToggleApproval(profile);
                  } finally {
                    setBusy(false);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg disabled:opacity-50 ${
                  profile.adminApproved
                    ? 'border border-amber-300 bg-amber-50 text-amber-900'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>
                  {profile.adminApproved ? 'Revoke Manual Approval' : 'Approve Profile Link (No Payment)'}
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onToggleActive(profile);
                  } finally {
                    setBusy(false);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 border text-xs font-semibold rounded-lg disabled:opacity-50 ${
                  profile.isPublic && !profile.adminDisabled
                    ? 'border-rose-300 text-rose-700 hover:bg-rose-50'
                    : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                }`}
              >
                <Power className="h-3.5 w-3.5" />
                <span>{profile.isPublic && !profile.adminDisabled ? 'Disable Link' : 'Enable Link'}</span>
              </button>
            </div>
          </div>

          {info.shortBio && (
            <div className="p-3.5 rounded-xl border border-slate-200 text-xs text-slate-700">
              <div className="font-semibold text-[#0B1D3A] mb-1">
                Short Bio ({vis.shortBio ? 'Visible publicly' : 'Hidden from public'})
              </div>
              <div
                className="leading-relaxed [&_p]:my-1"
                dangerouslySetInnerHTML={{ __html: sanitizeRichBioHtml(info.shortBio) }}
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {detailRows.map((row) => (
              <div key={row.label} className="p-3 rounded-xl border border-slate-200 text-xs">
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>{row.label}</span>
                  <span className={row.visible ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
                    {row.visible ? 'Public' : 'Private'}
                  </span>
                </div>
                <div className="mt-1 font-medium text-[#0B1D3A] break-words">
                  {row.value || '—'}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 space-y-2">
              <div className="text-xs font-bold text-[#0B1D3A]">
                Social Links ({(profile.socialLinks || []).length})
              </div>
              {(profile.socialLinks || []).length === 0 ? (
                <div className="text-xs text-slate-400">No social links added.</div>
              ) : (
                <div className="space-y-1.5">
                  {(profile.socialLinks || []).map((s) => (
                    <div key={s.id} className="text-xs flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700 truncate">{s.label}</span>
                      <span className="font-mono text-[11px] text-slate-500 truncate">{s.url}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 space-y-2">
              <div className="text-xs font-bold text-[#0B1D3A]">
                Custom Fields ({(profile.customFields || []).length})
              </div>
              {(profile.customFields || []).length === 0 ? (
                <div className="text-xs text-slate-400">No custom fields added.</div>
              ) : (
                <div className="space-y-1.5">
                  {(profile.customFields || []).map((c) => (
                    <div key={c.id} className="text-xs flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700 truncate">{c.label}</span>
                      <span className="text-slate-500 truncate">{c.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 1. Admin Dashboard with Analytics Charts
export const AdminDashboardPage: React.FC = () => {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [printers, setPrinters] = useState<PrinterRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAllUsers(), getAllOrders(), getAllPrinters(), getAllPayments()])
      .then(([u, o, p, pay]) => {
        setUsers(u);
        setOrders(o);
        setPrinters(p);
        setPayments(pay);
      })
      .finally(() => setLoading(false));
  }, []);

  const totalRevenue = orders
    .filter((o) => o.paymentStatus === 'Verified' || o.paymentStatus === 'Completed')
    .reduce((acc, o) => acc + (o.total || 0), 0);

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of orders) {
      map[o.orderStatus] = (map[o.orderStatus] || 0) + 1;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [orders]);

  const revenueByCardType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of orders) {
      const k = o.cardType || 'Standard SMART';
      map[k] = (map[k] || 0) + (o.total || 0);
    }
    return Object.entries(map).map(([name, revenue]) => ({ name, revenue }));
  }, [orders]);

  const metrics = [
    { label: 'Total Registered Users', value: users.length },
    { label: 'Active Users', value: users.filter((u) => u.status === 'Active').length },
    { label: 'Blocked Users', value: users.filter((u) => u.status === 'Blocked').length },
    { label: 'Print Partners', value: printers.length },
    { label: 'Total Orders', value: orders.length },
    { label: 'Pending Orders', value: orders.filter((o) => !['Delivered', 'Cancelled', 'Refunded'].includes(o.orderStatus)).length },
    { label: 'Completed Orders', value: orders.filter((o) => o.orderStatus === 'Delivered').length },
    { label: 'Verified Revenue (INR)', value: `₹${totalRevenue.toLocaleString('en-IN')}` },
    { label: 'Pending Payments', value: orders.filter((o) => o.paymentStatus === 'Pending').length || payments.filter((p) => p.status === 'Created').length },
  ];

  return (
    <PortalLayout portal="admin" title="Admin Operations Dashboard">
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {metrics.map((m) => (
            <div key={m.label} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">{m.label}</div>
              <div className="mt-1.5 font-display text-xl font-bold text-[#0B1D3A] tabular-nums">
                {loading ? '—' : m.value}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <h2 className="font-display font-bold text-sm text-[#0B1D3A] mb-4">Revenue by Card Finish (INR)</h2>
            <div className="h-64">
              {revenueByCardType.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">No order revenue yet</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueByCardType}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="revenue" fill="#1D4ED8" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <h2 className="font-display font-bold text-sm text-[#0B1D3A] mb-4">Order Status Distribution</h2>
            <div className="h-64">
              {statusCounts.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">No orders yet</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusCounts} dataKey="value" nameKey="name" outerRadius={85} label>
                      {statusCounts.map((_, idx) => (
                        <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-sm text-[#0B1D3A]">Recent Orders</h2>
            <Link to="/admin/orders" className="text-xs font-semibold text-[#1D4ED8] hover:underline">
              View All Orders →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Order #</th>
                  <th className="py-2.5 px-3">Customer</th>
                  <th className="py-2.5 px-3">Total</th>
                  <th className="py-2.5 px-3">Payment</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.slice(0, 6).map((o) => (
                  <tr key={o.orderId}>
                    <td className="py-2.5 px-3 font-mono font-semibold">{o.orderNumber}</td>
                    <td className="py-2.5 px-3">{o.shippingAddress.fullName}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">₹{o.total}</td>
                    <td className="py-2.5 px-3">{o.paymentStatus}</td>
                    <td className="py-2.5 px-3 font-semibold text-[#1D4ED8]">{o.orderStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
};

// 2. Users Management
export const AdminUsersPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify, confirmAction } = useToast();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const [newUid, setNewUid] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('USER');

  const load = () => getAllUsers().then(setUsers);
  useEffect(() => {
    load();
  }, []);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const matchText =
      !q ||
      u.email.toLowerCase().includes(q) ||
      (u.displayName || '').toLowerCase().includes(q) ||
      u.uid.toLowerCase().includes(q);
    const matchRole = roleFilter === 'ALL' || u.role === roleFilter;
    const matchStatus = statusFilter === 'ALL' || u.status === statusFilter;
    return matchText && matchRole && matchStatus;
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord) return;
    if (newRole === 'SUPERADMIN' && userRecord.role !== 'SUPERADMIN') {
      notify('Restricted', 'Only SuperAdmin can create SuperAdmin accounts.', 'error');
      return;
    }
    const uid = newUid.trim() || `usr_${Date.now()}`;
    await createManagedUserRecord({
      uid,
      email: newEmail.trim(),
      displayName: newName.trim(),
      role: newRole,
      status: 'Active',
      actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
    });
    setNewUid('');
    setNewEmail('');
    setNewName('');
    load();
    notify('User record created', `${newEmail} (${newRole})`, 'success');
  };

  const handleRoleStatus = async (target: UserRecord, role: UserRole, status: UserStatus) => {
    if (!userRecord) return;
    if ((target.role === 'SUPERADMIN' || role === 'SUPERADMIN') && userRecord.role !== 'SUPERADMIN') {
      notify('Restricted', 'Only SuperAdmin can modify SuperAdmin accounts.', 'error');
      return;
    }
    const activeSupers = users.filter((u) => u.role === 'SUPERADMIN' && u.status === 'Active');
    if (target.role === 'SUPERADMIN' && (role !== 'SUPERADMIN' || status !== 'Active') && activeSupers.length <= 1) {
      notify('Protected', 'Cannot demote or block the last active SuperAdmin.', 'error');
      return;
    }
    const ok = await confirmAction({
      title: 'Update User Account',
      message: `Set ${target.email} to Role: ${role}, Status: ${status}?`,
      confirmLabel: 'Apply Change',
    });
    if (!ok) return;
    await updateUserRoleAndStatus({
      targetUser: target,
      newRole: role,
      newStatus: status,
      actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
    });
    load();
    notify('Account updated', `${target.email} updated.`, 'success');
  };

  return (
    <PortalLayout portal="admin" title="Users & Customers">
      <AdminUsersHubTabs />
      <div className="space-y-6">
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Firebase UID (Optional)</label>
            <input
              type="text"
              value={newUid}
              onChange={(e) => setNewUid(e.target.value)}
              placeholder="Auto-generated if blank"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Full Name *</label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Email *</label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
            >
              <option value="USER">USER</option>
              <option value="PRINTER">PRINTER</option>
              <option value="ADMIN">ADMIN</option>
              {userRecord?.role === 'SUPERADMIN' && <option value="SUPERADMIN">SUPERADMIN</option>}
            </select>
          </div>
          <button type="submit" className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0B1D3A] text-white rounded-lg text-xs font-semibold">
            <Plus className="h-3.5 w-3.5" />
            <span>Add User</span>
          </button>
        </form>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email, name, UID..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white">
              <option value="ALL">All Roles</option>
              <option value="USER">USER</option>
              <option value="PRINTER">PRINTER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="SUPERADMIN">SUPERADMIN</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white">
              <option value="ALL">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Pending Verification">Pending Verification</option>
              <option value="Blocked">Blocked</option>
              <option value="Disabled">Disabled</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  'tapnex-users.csv',
                  filtered.map((u) => ({ uid: u.uid, email: u.email, name: u.displayName || '', role: u.role, status: u.status }))
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              onClick={() =>
                exportRowsToExcel(
                  'tapnex-users.xlsx',
                  'Users',
                  filtered.map((u) => ({ uid: u.uid, email: u.email, name: u.displayName || '', role: u.role, status: u.status }))
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Excel</span>
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((u) => (
                <tr key={u.uid}>
                  <td className="py-3 px-4">
                    <Link to={`/admin/users/${u.uid}`} className="font-semibold text-[#0B1D3A] hover:underline">
                      {u.displayName || u.username || u.email}
                    </Link>
                    <div className="text-slate-500">{u.email}</div>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={u.role}
                      disabled={u.role === 'SUPERADMIN' && userRecord?.role !== 'SUPERADMIN'}
                      onChange={(e) => handleRoleStatus(u, e.target.value as UserRole, u.status)}
                      className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                    >
                      <option value="USER">USER</option>
                      <option value="PRINTER">PRINTER</option>
                      <option value="ADMIN">ADMIN</option>
                      {userRecord?.role === 'SUPERADMIN' && <option value="SUPERADMIN">SUPERADMIN</option>}
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={u.status}
                      onChange={(e) => handleRoleStatus(u, u.role, e.target.value as UserStatus)}
                      className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                    >
                      <option value="Active">Active</option>
                      <option value="Pending Verification">Pending Verification</option>
                      <option value="Blocked">Blocked</option>
                      <option value="Disabled">Disabled</option>
                    </select>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Link to={`/admin/users/${u.uid}`} className="text-[#1D4ED8] font-semibold hover:underline">
                      Inspect
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PortalLayout>
  );
};

export const AdminUserDetailPage: React.FC = () => {
  const { uid } = useParams<{ uid: string }>();
  const { userRecord, requestPasswordReset, appSettings } = useAuth();
  const { notify, confirmAction } = useToast();
  const [user, setUser] = useState<UserRecord | null>(null);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [inspectedProfile, setInspectedProfile] = useState<ProfileRecord | null>(null);

  const load = () => {
    if (!uid) return;
    getUserById(uid).then(setUser);
    Promise.all([getUserProfiles(uid), getAllOrders()]).then(([profs, ords]) => {
      setProfiles(profs);
      setOrders(ords);
    });
  };

  useEffect(() => {
    load();
  }, [uid]);

  const handleToggleApproval = async (p: ProfileRecord) => {
    if (!userRecord) return;
    const updated = await adminSetProfileApproval({
      profile: p,
      approved: !p.adminApproved,
      actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
      inactiveMessage: appSettings.inactiveProfileMessage,
    });
    notify(
      updated.adminApproved ? 'Profile approved without payment' : 'Manual approval revoked',
      `/p/${p.slug}`,
      'success'
    );
    setInspectedProfile((curr) => (curr?.profileId === p.profileId ? updated : curr));
    load();
  };

  const handleTogglePublic = async (p: ProfileRecord) => {
    if (!userRecord) return;
    const nextPublic = !(p.isPublic && !p.adminDisabled);
    const updated = await adminToggleProfileStatus({
      profile: p,
      isPublic: nextPublic,
      actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
      inactiveMessage: appSettings.inactiveProfileMessage,
    });
    notify(nextPublic ? 'Profile enabled' : 'Profile link disabled', `/p/${p.slug}`, 'success');
    setInspectedProfile((curr) => (curr?.profileId === p.profileId ? updated : curr));
    load();
  };

  const handleMarkPaymentCompleted = async (p: ProfileRecord, completed: boolean) => {
    if (!userRecord) return;
    const ok = await confirmAction({
      title: completed ? 'Reconcile Profile Payment' : 'Revoke Profile Payment Status',
      message: completed
        ? `Confirm payment reconciliation for /p/${p.slug}? This unlocks the public profile via server Cloud Function and creates an audit log.`
        : `Clear payment confirmation status for /p/${p.slug}?`,
      destructive: !completed,
      confirmLabel: completed ? 'Confirm Reconciliation' : 'Revoke Payment',
    });
    if (!ok) return;
    try {
      const res = await adminReconcileProfilePayment({
        profileId: p.profileId,
        completed,
        reason: completed
          ? 'Admin reconciled profile payment from User Detail'
          : 'Admin revoked profile payment from User Detail',
      });
      const updated: ProfileRecord = {
        ...p,
        paymentConfirmed: res.paymentConfirmed,
        paymentCompletedAt: res.paymentCompletedAt,
        paymentReference: res.paymentReference,
        isPublic: res.isPublic,
      };
      notify(
        completed ? 'Payment reconciled' : 'Payment status cleared',
        `/p/${p.slug}`,
        'success'
      );
      setInspectedProfile((curr) => (curr?.profileId === p.profileId ? updated : curr));
      load();
    } catch (err) {
      notify(
        'Payment reconciliation failed',
        err instanceof Error ? err.message : 'Unable to reconcile profile payment.',
        'error'
      );
    }
  };

  return (
    <PortalLayout portal="admin" title="User Account Detail">
      <AdminUsersHubTabs />
      {!user ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-sm text-slate-500">Loading user...</div>
      ) : (
        <div className="space-y-6 max-w-4xl">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="font-display text-xl font-bold text-[#0B1D3A]">{user.displayName || user.email}</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-xs text-slate-500 block">UID</span><span className="font-mono text-xs">{user.uid}</span></div>
              <div><span className="text-xs text-slate-500 block">Email</span><span>{user.email}</span></div>
              <div><span className="text-xs text-slate-500 block">Role</span><span className="font-semibold">{user.role}</span></div>
              <div><span className="text-xs text-slate-500 block">Status</span><span className="font-semibold">{user.status}</span></div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await requestPasswordReset(user.email);
                notify('Password reset triggered', `Sent Firebase password reset email to ${user.email}.`, 'success');
              }}
              className="px-4 py-2 bg-[#0B1D3A] text-white text-xs font-semibold rounded-lg"
            >
              Send Secure Password Reset Email
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h3 className="font-display font-bold text-base text-[#0B1D3A]">User Digital Profiles ({profiles.length})</h3>
            {profiles.length === 0 ? (
              <p className="text-xs text-slate-500">No digital profiles created by this user.</p>
            ) : (
              <div className="space-y-3">
                {profiles.map((p) => {
                  const paid =
                    Boolean(p.paymentConfirmed) ||
                    isOrderPaymentConfirmed(orders, p.profileId, p.slug);
                  return (
                    <div key={p.profileId} className="p-4 border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-sm text-[#0B1D3A]">
                          {p.profileLabel || p.personalInformation.fullName || p.slug}
                        </div>
                        <div className="text-xs font-mono text-slate-500">
                          /p/{p.slug} · {p.adminDisabled ? 'Disabled by Admin' : p.isPublic ? 'Enabled' : 'Disabled'} ·{' '}
                          {paid ? 'Paid' : p.adminApproved ? 'Admin Approved' : 'Payment Pending'}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setInspectedProfile(p)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 border border-[#1D4ED8]/30 bg-blue-50/70 text-[#1D4ED8] rounded-lg text-xs font-semibold hover:bg-blue-100"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Inspect Profile</span>
                        </button>
                        {!p.paymentConfirmed && (
                          <button
                            type="button"
                            onClick={() => handleMarkPaymentCompleted(p, true)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1D4ED8] hover:bg-blue-700 text-white text-xs font-semibold"
                          >
                            <CreditCard className="h-3.5 w-3.5" />
                            <span>Mark Paid</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleApproval(p)}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                            p.adminApproved
                              ? 'border border-amber-300 bg-amber-50 text-amber-800'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          }`}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          <span>{p.adminApproved ? 'Revoke Approval' : 'Approve Link'}</span>
                        </button>
                        <a
                          href={`/p/${p.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>Public View</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => handleTogglePublic(p)}
                          className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-50"
                        >
                          {p.isPublic && !p.adminDisabled ? 'Disable Link' : 'Enable Link'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!userRecord) return;
                            const ok = await confirmAction({
                              title: 'Delete Digital Profile',
                              message: `Permanently delete /p/${p.slug}?`,
                              destructive: true,
                              confirmLabel: 'Delete',
                            });
                            if (!ok) return;
                            await deleteDigitalProfile({
                              profile: p,
                              actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
                            });
                            notify('Digital profile deleted', `/p/${p.slug}`, 'success');
                            load();
                          }}
                          className="px-3 py-1.5 border border-rose-200 text-rose-600 rounded-lg text-xs font-semibold hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {inspectedProfile && (
        <AdminProfileInspectorModal
          profile={inspectedProfile}
          owner={user}
          paid={
            Boolean(inspectedProfile.paymentConfirmed) ||
            isOrderPaymentConfirmed(orders, inspectedProfile.profileId, inspectedProfile.slug)
          }
          onClose={() => setInspectedProfile(null)}
          onToggleApproval={handleToggleApproval}
          onToggleActive={handleTogglePublic}
          onMarkPaymentCompleted={handleMarkPaymentCompleted}
        />
      )}
    </PortalLayout>
  );
};

// 3. Printers Management
export const AdminPrintersPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify } = useToast();
  const [printers, setPrinters] = useState<PrinterRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [linkingPrinterId, setLinkingPrinterId] = useState<string | null>(null);
  const [uidInput, setUidInput] = useState(() => generatePrinterAuthId());
  const [businessName, setBusinessName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const load = () =>
    Promise.all([getAllPrinters(), getAllOrders(), getAllUsers()]).then(([p, o, u]) => {
      setPrinters(p);
      setOrders(o);
      setUsers(u);
    });
  useEffect(() => { load(); }, []);

  const handleAddPrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord) return;
    const pid = uidInput.trim() || generatePrinterAuthId();
    await savePrinterRecord(
      {
        printerId: pid,
        uid: pid,
        businessName,
        contactPerson,
        email,
        phone,
        status: 'Active',
        serviceAreas: ['All India'],
      },
      { uid: userRecord.uid, email: userRecord.email, role: userRecord.role }
    );
    setUidInput(generatePrinterAuthId());
    setBusinessName('');
    setContactPerson('');
    setEmail('');
    setPhone('');
    load();
    notify('Printer saved', `${businessName} (${pid})`, 'success');
  };

  return (
    <PortalLayout portal="admin" title="Print Partners Management">
      <AdminUsersHubTabs />
      <div className="space-y-6">
        <form onSubmit={handleAddPrinter} className="bg-white border border-slate-200 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Print Auth ID (Auto-Generated)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                required
                value={uidInput}
                onChange={(e) => setUidInput(e.target.value)}
                placeholder="prt_auto_id"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono bg-slate-50"
              />
              <button
                type="button"
                onClick={() => setUidInput(generatePrinterAuthId())}
                title="Regenerate Print Auth ID"
                className="p-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100 shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Press Business Name *</label>
            <input type="text" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Press Business Name *" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Contact Person *</label>
            <input type="text" required value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Contact Person *" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Email *</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email *" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs" />
          </div>
          <button type="submit" className="px-4 py-2 bg-[#0B1D3A] hover:bg-[#132A52] text-white rounded-lg text-xs font-semibold h-[34px]">Add Printer</button>
        </form>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-3 px-4">Facility</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Printer Login</th>
                <th className="py-3 px-4">Assigned Jobs</th>
                <th className="py-3 px-4">Dispatched</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Toggle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {printers.map((p) => {
                const pOrders = orders.filter((o) => o.printerId === p.printerId);
                const done = pOrders.filter((o) => ['Dispatched', 'In Transit', 'Delivered'].includes(o.orderStatus)).length;
                const linkedUser = p.uid !== p.printerId
                  ? users.find((u) => u.uid === p.uid && u.role === 'PRINTER')
                  : undefined;
                const sameUidUser = p.uid === p.printerId
                  ? users.find((u) => u.uid === p.uid && u.role === 'PRINTER')
                  : undefined;
                const matchingUser = p.uid === p.printerId
                  ? users.find((u) =>
                      u.uid !== p.printerId &&
                      u.role === 'PRINTER' &&
                      u.status === 'Active' &&
                      u.email.trim().toLowerCase() === p.email.trim().toLowerCase()
                    )
                  : undefined;
                return (
                  <tr key={p.printerId}>
                    <td className="py-3 px-4 font-semibold text-[#0B1D3A]">{p.businessName}<div className="font-mono text-[11px] text-slate-400">{p.printerId}</div></td>
                    <td className="py-3 px-4">{p.contactPerson}<div className="text-slate-500">{p.email}</div></td>
                    <td className="py-3 px-4">
                      {p.uid !== p.printerId ? (
                        <div className="text-emerald-700 font-medium">Linked<div className="text-slate-500 font-normal">{linkedUser?.email || p.email}</div></div>
                      ) : sameUidUser ? (
                        <div className="text-emerald-700 font-medium">Linked<div className="text-slate-500 font-normal">{sameUidUser.email} (same UID)</div></div>
                      ) : matchingUser ? (
                        <button
                          type="button"
                          disabled={linkingPrinterId === p.printerId}
                          onClick={async () => {
                            setLinkingPrinterId(p.printerId);
                            try {
                              await linkPrinterAccount(p.printerId, matchingUser.uid);
                              await load();
                              notify('Printer login linked', `${p.businessName} is now linked to ${matchingUser.email}.`, 'success');
                            } catch (err) {
                              notify('Unable to link printer login', err instanceof Error ? err.message : 'Please check the printer account and try again.', 'error');
                            } finally {
                              setLinkingPrinterId(null);
                            }
                          }}
                          className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-xs font-semibold disabled:opacity-50"
                        >
                          {linkingPrinterId === p.printerId ? 'Linking...' : 'Link Login'}
                        </button>
                      ) : (
                        <span className="text-slate-400">No matching verified PRINTER login</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">{pOrders.length}</td>
                    <td className="py-3 px-4 font-mono tabular-nums">{done}</td>
                    <td className="py-3 px-4 font-semibold">{p.status}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!userRecord) return;
                          await savePrinterRecord(
                            { ...p, status: p.status === 'Active' ? 'Blocked' : 'Active' },
                            { uid: userRecord.uid, email: userRecord.email, role: userRecord.role }
                          );
                          load();
                        }}
                        className="px-3 py-1 border border-slate-300 rounded text-xs font-medium hover:bg-slate-50"
                      >
                        {p.status === 'Active' ? 'Block' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PortalLayout>
  );
};

// 4. Orders & Payment Status Dashboard
export const AdminOrdersPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify, confirmAction } = useToast();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [paymentFilter, setPaymentFilter] = useState('ALL');

  const load = () => getAllOrders().then(setOrders);
  useEffect(() => { load(); }, []);

  const filtered = orders.filter((o) => {
    const q = search.toLowerCase();
    const matchText =
      !q ||
      o.orderNumber.toLowerCase().includes(q) ||
      o.shippingAddress.fullName.toLowerCase().includes(q) ||
      (o.profileSlug || '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'ALL' || o.orderStatus === statusFilter;
    const matchPayment = paymentFilter === 'ALL' || o.paymentStatus === paymentFilter;
    return matchText && matchStatus && matchPayment;
  });

  const pendingPayCount = orders.filter((o) => o.paymentStatus === 'Pending').length;
  const completedPayCount = orders.filter((o) => o.paymentStatus === 'Completed' || o.paymentStatus === 'Verified').length;
  const rejectedPayCount = orders.filter((o) => ['Rejected', 'Failed', 'Refunded'].includes(o.paymentStatus)).length;
  const confirmedRev = orders
    .filter((o) => o.paymentStatus === 'Completed' || o.paymentStatus === 'Verified')
    .reduce((acc, o) => acc + (o.total || 0), 0);

  return (
    <PortalLayout portal="admin" title="Orders & Payment Status Dashboard">
      <AdminOrdersHubTabs />
      <div className="space-y-5">
        {/* Payment & Order KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Total Orders</div>
            <div className="mt-1 font-display text-xl font-bold text-[#0B1D3A] tabular-nums">{orders.length}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Payment Pending</div>
            <div className="mt-1 font-display text-xl font-bold text-amber-600 tabular-nums">{pendingPayCount}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Completed / Verified</div>
            <div className="mt-1 font-display text-xl font-bold text-emerald-700 tabular-nums">
              {completedPayCount} (₹{confirmedRev.toLocaleString('en-IN')})
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Rejected / Failed / Refunded</div>
            <div className="mt-1 font-display text-xl font-bold text-rose-700 tabular-nums">{rejectedPayCount}</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2.5 flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order #, customer, slug..."
              className="px-3 py-2 border border-slate-300 rounded-lg text-xs min-w-[200px]"
            />
            <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white">
              <option value="ALL">All Payment Statuses</option>
              {PAYMENT_STATUS_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white">
              <option value="ALL">All Order Statuses</option>
              {[...ORDER_STATUS_FLOW, 'Cancelled', 'Refunded'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() =>
              exportRowsToExcel(
                'tapnex-orders.xlsx',
                'Orders',
                filtered.map((o) => ({
                  orderNumber: o.orderNumber,
                  customer: o.shippingAddress.fullName,
                  city: o.shippingAddress.city,
                  total: o.total,
                  paymentStatus: o.paymentStatus,
                  orderStatus: o.orderStatus,
                  printerId: o.printerId || '',
                }))
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Excel</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-3 px-4">Order #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Total</th>
                <th className="py-3 px-4">Payment Status</th>
                <th className="py-3 px-4">Printer</th>
                <th className="py-3 px-4">Order Status</th>
                <th className="py-3 px-4 text-right">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((o) => (
                <tr key={o.orderId}>
                  <td className="py-3 px-4 font-mono font-semibold text-[#0B1D3A]">
                    {o.orderNumber}
                    {o.profileSlug && <div className="text-[11px] font-normal text-slate-400">/p/{o.profileSlug}</div>}
                    {(o.orderSource === 'shop' || o.shopItems?.length) && (
                      <div className="text-[10px] font-sans font-semibold text-[#1D4ED8]">
                        Shop ({o.shopItems?.reduce((acc, it) => acc + it.quantity, 0) || o.quantity} items)
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4">{o.shippingAddress.fullName}</td>
                  <td className="py-3 px-4 font-mono tabular-nums">₹{o.total}</td>
                  <td className="py-3 px-4">
                    <select
                      value={o.paymentStatus}
                      onChange={async (e) => {
                        if (!userRecord) return;
                        const nextPay = e.target.value as PaymentStatus;
                        if (nextPay === o.paymentStatus) return;
                        const ok = await confirmAction({
                          title: 'Server Payment Reconciliation',
                          message: `Reconcile payment status for ${o.orderNumber} from "${o.paymentStatus}" to "${nextPay}"? This runs via verified Cloud Function and writes to auditLogs.`,
                          destructive: nextPay === 'Refunded' || nextPay === 'Rejected',
                          confirmLabel: `Set ${nextPay}`,
                        });
                        if (!ok) return;
                        const suggestedOrderStatus: OrderStatus =
                          nextPay === 'Completed' || nextPay === 'Verified'
                            ? o.orderStatus === 'Awaiting Payment'
                              ? 'Payment Successful'
                              : o.orderStatus
                            : nextPay === 'Refunded'
                              ? 'Refunded'
                              : nextPay === 'Rejected'
                                ? 'Cancelled'
                                : o.orderStatus;
                        try {
                          await adminReconcileOrderPayment({
                            orderId: o.orderId,
                            paymentStatus: nextPay,
                            orderStatus: suggestedOrderStatus,
                            reason: `Admin Orders ledger payment reconciliation (${o.paymentStatus} -> ${nextPay})`,
                          });
                          if (nextPay === 'Verified' || nextPay === 'Completed') {
                            try {
                              await adminEnsureOrderQr(o.orderId);
                              notify(
                                'Payment reconciled & QR ready',
                                `${o.orderNumber} -> ${nextPay}. QR artwork and print files are ready.`,
                                'success'
                              );
                            } catch (qrErr) {
                              notify(
                                'Payment reconciled; QR pending',
                                qrErr instanceof Error
                                  ? qrErr.message
                                  : 'Payment was reconciled, but QR generation failed. Use Generate Print QR & Prepare Files on the order details page.',
                                'info'
                              );
                            }
                          } else {
                            notify('Payment reconciled', `${o.orderNumber} -> ${nextPay}`, 'success');
                          }
                          load();
                        } catch (err) {
                          notify(
                            'Reconciliation failed',
                            err instanceof Error ? err.message : 'Unable to reconcile order payment.',
                            'error'
                          );
                        }
                      }}
                      className="px-2 py-1 border border-slate-300 rounded bg-white text-xs font-semibold"
                    >
                      {PAYMENT_STATUS_OPTIONS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px]">
                    {o.printerId === 'admin_inhouse'
                      ? 'In-House (Admin)'
                      : o.printerId || 'Unassigned'}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[#1D4ED8]">{o.orderStatus}</div>
                    {ORDER_STATUS_FLOW.includes(o.orderStatus) && (
                      <div className="text-[10px] font-mono text-slate-400">
                        Step {ORDER_STATUS_FLOW.indexOf(o.orderStatus) + 1}/{ORDER_STATUS_FLOW.length}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <Link to={`/admin/orders/${o.orderId}`} className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#0B1D3A] hover:bg-[#132A52] text-white rounded-lg text-xs font-semibold">
                      <span>Fulfil / Timeline</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PortalLayout>
  );
};

export const AdminOrderDetailPage: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const { userRecord } = useAuth();
  const { notify, confirmAction } = useToast();
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [design, setDesign] = useState<CardDesignRecord | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [printers, setPrinters] = useState<PrinterRecord[]>([]);
  const [qr, setQr] = useState<QrCodeRecord | null>(null);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [notes, setNotes] = useState('');
  const [updatingWorkflow, setUpdatingWorkflow] = useState(false);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Admin In-House / Direct Courier Dispatch State
  const [showDispatchForm, setShowDispatchForm] = useState(false);
  const [courierName, setCourierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().slice(0, 10));

  const load = async () => {
    if (!orderId) return;
    const [ord, prts] = await Promise.all([getOrderById(orderId), getAllPrinters()]);
    setOrder(ord);
    setPrinters(prts);
    if (ord) {
      setSelectedPrinter(ord.printerId || 'admin_inhouse');
      setNotes(ord.internalNotes || '');
      setCourierName(ord.courierName || '');
      setTrackingNumber(ord.trackingNumber || '');
      setTrackingUrl(ord.trackingUrl || '');
      if (ord.dispatchDate) setDispatchDate(ord.dispatchDate);

      const [des, prof, qrDoc] = await Promise.all([
        getCardDesignById(ord.designId),
        getProfileById(ord.profileId),
        ord.qrCodeId ? getQrCodeById(ord.qrCodeId) : Promise.resolve(null),
      ]);
      setDesign(des);
      setProfile(prof);
      setQr(qrDoc);
    }
  };
  useEffect(() => { load(); }, [orderId]);

  if (!order) {
    return (
      <PortalLayout portal="admin" title="Order Detail">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-sm text-slate-500">Loading order...</div>
      </PortalLayout>
    );
  }

  const cardPersonalInfo: Partial<PersonalInformation> = {
    ...(profile?.personalInformation || {}),
    fullName: profile?.personalInformation?.fullName || order.shippingAddress.fullName,
    mobile: profile?.personalInformation?.mobile || order.shippingAddress.mobile,
    email: profile?.personalInformation?.email || order.shippingAddress.email,
  };

  const assignedPrinterObj = printers.find((p) => p.printerId === order.printerId);
  const printerLabel =
    order.printerId === 'admin_inhouse'
      ? 'In-House Print Press (Admin)'
      : assignedPrinterObj
        ? assignedPrinterObj.businessName
        : order.printerId || 'Unassigned';

  const handleTimelineStatusSelect = async (nextStatus: OrderStatus) => {
    if (!userRecord || updatingWorkflow) return;
    setUpdatingWorkflow(true);
    try {
      await updateOrderWorkflow({
        orderId: order.orderId,
        updates: { orderStatus: nextStatus },
        actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
        auditAction: 'ADMIN_TIMELINE_STEP',
        auditDetails: `Order ${order.orderNumber} progressed to ${nextStatus}`,
      });
      if (nextStatus === 'Printing in Progress') {
        await sendAndLogTransactionalEmail({
          uid: order.uid,
          to: order.shippingAddress.email,
          templateId: 'printing_started',
          variables: { ORDER_NUMBER: order.orderNumber },
        });
      } else if (nextStatus === 'Delivered') {
        await sendAndLogTransactionalEmail({
          uid: order.uid,
          to: order.shippingAddress.email,
          templateId: 'delivered',
          variables: { ORDER_NUMBER: order.orderNumber },
        });
      }
      notify('Fulfilment updated', `${order.orderNumber} → ${nextStatus}`, 'success');
      await load();
    } finally {
      setUpdatingWorkflow(false);
    }
  };

  const handlePrepareQrAndPrint = async (): Promise<QrCodeRecord | null> => {
    if (!userRecord || !order) return null;
    setPreparingPrint(true);
    try {
      const preparedQr = await adminEnsureOrderQr(order.orderId);
      setQr(preparedQr);
      notify('Print files ready', 'Verified high-resolution QR code generated and attached.', 'success');
      await load();
      return preparedQr;
    } catch (err) {
      notify('QR preparation failed', err instanceof Error ? err.message : 'Unable to prepare QR.', 'error');
      return null;
    } finally {
      setPreparingPrint(false);
    }
  };

  const handleDownloadPdf = async (withGuides: boolean) => {
    if (!design) {
      notify('Missing card design', 'Linked card design could not be loaded.', 'error');
      return;
    }
    setGeneratingPdf(true);
    try {
      let activeQr = qr;
      if (!activeQr?.pngDataUrl) {
        activeQr = await handlePrepareQrAndPrint();
      }
      if (!activeQr?.pngDataUrl) return;
      const res = await generatePrintReadyPdfBlob({
        design,
        info: cardPersonalInfo,
        qrPngDataUrl: activeQr.pngDataUrl,
        includeProofGuides: withGuides,
      });
      downloadBlob(res.blob, `${order.orderNumber}-${withGuides ? 'proof' : '300dpi-print'}.pdf`);
      notify('Print PDF downloaded', `${res.specs.trimMm} + ${res.specs.bleedMm} bleed @ ${res.specs.dpi} DPI`, 'success');
    } catch (err) {
      notify('PDF generation failed', err instanceof Error ? err.message : 'Unable to generate PDF.', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDownloadSidePng = async (side: 'front' | 'back') => {
    if (!design) {
      notify('Missing card design', 'Linked card design could not be loaded.', 'error');
      return;
    }
    setGeneratingPdf(true);
    try {
      let activeQr = qr;
      if (!activeQr?.pngDataUrl) {
        activeQr = await handlePrepareQrAndPrint();
      }
      if (!activeQr?.pngDataUrl) return;
      const res = await generateCardSidePngBlob({
        design,
        side,
        info: cardPersonalInfo,
        qrPngDataUrl: activeQr.pngDataUrl,
      });
      downloadBlob(res.blob, `${order.orderNumber}-${side}.png`);
      notify(
        `${side === 'front' ? 'Front' : 'Back'} PNG downloaded`,
        `${res.widthPx} × ${res.heightPx} px (300 DPI PNG)`,
        'success'
      );
    } catch (err) {
      notify('PNG export failed', err instanceof Error ? err.message : 'Unable to generate PNG.', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleAdminDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord) return;
    setUpdatingWorkflow(true);
    try {
      await dispatchOrderWithCourier({
        order,
        printerUid: order.printerId || 'admin_inhouse',
        actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
        courierName: courierName.trim(),
        trackingNumber: trackingNumber.trim(),
        trackingUrl: trackingUrl.trim(),
        dispatchDate,
      });
      await sendAndLogTransactionalEmail({
        uid: order.uid,
        to: order.shippingAddress.email,
        templateId: 'dispatched',
        variables: {
          ORDER_NUMBER: order.orderNumber,
          COURIER_NAME: courierName.trim(),
          TRACKING_NUMBER: trackingNumber.trim(),
        },
      });
      setShowDispatchForm(false);
      notify('Order dispatched', `Courier ${courierName} (${trackingNumber}) recorded and customer notified.`, 'success');
      await load();
    } finally {
      setUpdatingWorkflow(false);
    }
  };

  return (
    <PortalLayout portal="admin" title={`Order ${order.orderNumber}`}>
      <div className="space-y-6">
        {/* Top Summary + Instant 300 DPI Print Actions */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500">
              <span>{order.orderNumber}</span>
              <span>·</span>
              <span>Qty {order.quantity}</span>
              <span>·</span>
              <span>{order.cardType}</span>
              <span>·</span>
              <span className="font-semibold text-[#0B1D3A]">₹{order.total}</span>
            </div>
            <h2 className="font-display text-xl font-bold text-[#0B1D3A]">
              {order.shippingAddress.fullName}
            </h2>
            <p className="text-xs text-slate-600">
              {order.shippingAddress.email} · {order.shippingAddress.mobile} · {order.shippingAddress.city}, {order.shippingAddress.state} ({order.shippingAddress.pinCode})
            </p>
            {order.profileSlug && (
              <a
                href={`/p/${order.profileSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-mono text-[#1D4ED8] hover:underline pt-0.5"
              >
                <span>Public Profile: /p/{order.profileSlug}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={generatingPdf || preparingPrint}
              onClick={() => handleDownloadPdf(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#0B1D3A] hover:bg-[#132A52] text-white rounded-xl text-xs font-semibold disabled:opacity-50"
            >
              <PrinterIcon className="h-4 w-4" />
              <span>{generatingPdf ? 'Building...' : 'Download PDF'}</span>
            </button>
            <button
              type="button"
              disabled={generatingPdf || preparingPrint}
              onClick={() => handleDownloadSidePng('front')}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold disabled:opacity-50"
            >
              <ImageIcon className="h-4 w-4 text-[#1D4ED8]" />
              <span>Front PNG</span>
            </button>
            <button
              type="button"
              disabled={generatingPdf || preparingPrint}
              onClick={() => handleDownloadSidePng('back')}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold disabled:opacity-50"
            >
              <ImageIcon className="h-4 w-4 text-emerald-600" />
              <span>Back PNG</span>
            </button>
            <button
              type="button"
              disabled={generatingPdf || preparingPrint}
              onClick={() => handleDownloadPdf(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              <span>Proof w/ Guides</span>
            </button>
            <button
              type="button"
              onClick={() => setShowDispatchForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-[#1D4ED8] text-[#1D4ED8] bg-blue-50/70 hover:bg-blue-100 rounded-xl text-xs font-semibold"
            >
              <Truck className="h-4 w-4" />
              <span>{order.trackingNumber ? 'Update Courier / AWB' : 'Dispatch Order'}</span>
            </button>
          </div>
        </div>

        {/* Interactive End-to-End 12-Step Fulfilment Timeline */}
        <FulfilmentTimeline
          currentStatus={order.orderStatus}
          interactive
          updating={updatingWorkflow}
          printerLabel={printerLabel}
          courierName={order.courierName}
          trackingNumber={order.trackingNumber}
          trackingUrl={order.trackingUrl}
          dispatchDate={order.dispatchDate}
          onSelectStatus={handleTimelineStatusSelect}
          onOpenDispatchForm={() => setShowDispatchForm(true)}
        />

        {/* In-House / Admin Courier Dispatch Panel */}
        {showDispatchForm && (
          <form onSubmit={handleAdminDispatch} className="bg-white border border-blue-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-display font-bold text-sm text-[#0B1D3A]">
                <Truck className="h-4 w-4 text-[#1D4ED8]" />
                <span>Courier Dispatch & Tracking (Sets Status to Dispatched)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowDispatchForm(false)}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Courier Partner *</label>
                <input
                  type="text"
                  required
                  value={courierName}
                  onChange={(e) => setCourierName(e.target.value)}
                  placeholder="BlueDart / Delhivery / DTDC"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">AWB / Tracking Number *</label>
                <input
                  type="text"
                  required
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="AWB123456789"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Tracking URL (Optional)</label>
                <input
                  type="url"
                  value={trackingUrl}
                  onChange={(e) => setTrackingUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Dispatch Date *</label>
                <input
                  type="date"
                  required
                  value={dispatchDate}
                  onChange={(e) => setDispatchDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={updatingWorkflow}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
            >
              Confirm Dispatch & Notify Customer
            </button>
          </form>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Printer Assignment, Payment & Notes */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="font-display font-bold text-base text-[#0B1D3A]">Print Routing, Payment & Notes</h2>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600">Assign Print Facility / In-House Press</label>
              <div className="flex gap-2">
                <select
                  value={selectedPrinter}
                  onChange={(e) => setSelectedPrinter(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="admin_inhouse">In-House Print Press (Admin Direct)</option>
                  {printers.map((p) => (
                    <option key={p.printerId} value={p.printerId}>{p.businessName} ({p.printerId})</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    if (!userRecord || !selectedPrinter) return;
                    try {
                      await assignOrderPrinter(order.orderId, selectedPrinter);
                      notify('Print destination updated', `Routed to ${selectedPrinter === 'admin_inhouse' ? 'In-House Press' : selectedPrinter}.`, 'success');
                      load();
                    } catch (err) {
                      notify(
                        'Printer assignment failed',
                        err instanceof Error ? err.message : 'Unable to assign printer.',
                        'error'
                      );
                    }
                  }}
                  className="px-4 py-2 bg-[#1D4ED8] text-white text-xs font-semibold rounded-lg"
                >
                  Assign
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600">Change Payment Status</label>
                <select
                  value={order.paymentStatus}
                  onChange={async (e) => {
                    if (!userRecord) return;
                    const nextPay = e.target.value as PaymentStatus;
                    if (nextPay === order.paymentStatus) return;
                    const ok = await confirmAction({
                      title: 'Server Payment Reconciliation',
                      message: `Reconcile payment status for ${order.orderNumber} from "${order.paymentStatus}" to "${nextPay}"? This executes through a verified server Cloud Function.`,
                      destructive: nextPay === 'Refunded' || nextPay === 'Rejected',
                      confirmLabel: `Set ${nextPay}`,
                    });
                    if (!ok) return;
                    try {
                      await adminReconcileOrderPayment({
                        orderId: order.orderId,
                        paymentStatus: nextPay,
                        reason: `Admin order detail payment reconciliation (${order.paymentStatus} -> ${nextPay})`,
                      });
                      if (nextPay === 'Verified' || nextPay === 'Completed') {
                        try {
                          await adminEnsureOrderQr(order.orderId);
                          notify(
                            'Payment reconciled & QR ready',
                            `${order.orderNumber} -> ${nextPay}. QR artwork and print files are ready.`,
                            'success'
                          );
                        } catch (qrErr) {
                          notify(
                            'Payment reconciled; QR pending',
                            qrErr instanceof Error
                              ? qrErr.message
                              : 'Payment was reconciled, but QR generation failed. Use Generate Print QR & Prepare Files on this order page.',
                            'info'
                          );
                        }
                      } else {
                        notify('Payment reconciled', nextPay, 'success');
                      }
                      load();
                    } catch (err) {
                      notify(
                        'Reconciliation failed',
                        err instanceof Error ? err.message : 'Unable to reconcile order payment.',
                        'error'
                      );
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-semibold"
                >
                  {PAYMENT_STATUS_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600">Change Order Status</label>
                <select
                  value={order.orderStatus}
                  onChange={(e) => handleTimelineStatusSelect(e.target.value as OrderStatus)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {[...ORDER_STATUS_FLOW, 'Cancelled', 'Refunded'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2">
              <label className="block text-xs font-medium text-slate-600">Internal Admin Notes</label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!userRecord) return;
                    await updateOrderWorkflow({
                      orderId: order.orderId,
                      updates: { internalNotes: notes },
                      actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
                      auditAction: 'UPDATE_ORDER_NOTES',
                      auditDetails: `Updated internal notes on ${order.orderNumber}`,
                    });
                    notify('Notes saved', 'Audit log recorded.', 'success');
                  }}
                  className="px-4 py-2 bg-[#0B1D3A] text-white text-xs font-semibold rounded-lg"
                >
                  Save Notes
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!userRecord) return;
                    const ok = await confirmAction({
                      title: 'Cancel & Refund Order',
                      message: `Mark order ${order.orderNumber} as Refunded and notify customer?`,
                      destructive: true,
                      confirmLabel: 'Initiate Refund',
                    });
                    if (!ok) return;
                    try {
                      await adminReconcileOrderPayment({
                        orderId: order.orderId,
                        paymentStatus: 'Refunded',
                        orderStatus: 'Refunded',
                        reason: `Admin initiated refund and cancellation for ${order.orderNumber}`,
                      });
                      await sendAndLogTransactionalEmail({
                        uid: order.uid,
                        to: order.shippingAddress.email,
                        templateId: 'refund_notification',
                        variables: { ORDER_NUMBER: order.orderNumber, AMOUNT: String(order.total) },
                      });
                      notify('Order refunded', `${order.orderNumber} marked Refunded via server.`, 'success');
                      load();
                    } catch (err) {
                      notify(
                        'Refund reconciliation failed',
                        err instanceof Error ? err.message : 'Unable to process refund status.',
                        'error'
                      );
                    }
                  }}
                  className="px-4 py-2 border border-rose-300 text-rose-700 text-xs font-semibold rounded-lg"
                >
                  Cancel / Refund
                </button>
              </div>
            </div>
          </div>

          {/* QR Artwork & Print File Readiness / Shop Items */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            {order.shopItems && order.shopItems.length > 0 && (
              <div className="space-y-3 pb-4 border-b border-slate-100">
                <h2 className="font-display font-bold text-base text-[#0B1D3A]">
                  Ordered Shop Smart Tags ({order.shopItems.reduce((a, b) => a + b.quantity, 0)} items)
                </h2>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {order.shopItems.map((it) => (
                    <div key={it.productId} className="p-3 bg-slate-50/70 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#0B1D3A]">{it.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {[it.categoryName, it.cardType].filter(Boolean).join(' · ') || 'Smart Safety Tag'}
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div className="text-slate-600">{it.quantity} × ₹{it.priceInr}</div>
                        <div className="font-bold text-[#0B1D3A]">₹{it.lineTotal ?? it.priceInr * it.quantity}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <h2 className="font-display font-bold text-base text-[#0B1D3A]">Verified QR Code &amp; Print Files</h2>
            {qr?.pngDataUrl ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <img src={qr.pngDataUrl} alt="Order QR" className="w-28 h-28 border border-slate-200 rounded-xl shrink-0" />
                <div className="space-y-2.5 text-xs min-w-0 flex-1">
                  <div className="font-mono text-slate-600 break-all">{qr.targetUrl}</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={generatingPdf}
                      onClick={() => handleDownloadPdf(false)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#0B1D3A] text-white rounded-lg font-semibold disabled:opacity-50"
                    >
                      <PrinterIcon className="h-3.5 w-3.5" />
                      <span>Download PDF</span>
                    </button>
                    <button
                      type="button"
                      disabled={generatingPdf}
                      onClick={() => handleDownloadSidePng('front')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <ImageIcon className="h-3.5 w-3.5 text-[#1D4ED8]" />
                      <span>Front PNG</span>
                    </button>
                    <button
                      type="button"
                      disabled={generatingPdf}
                      onClick={() => handleDownloadSidePng('back')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <ImageIcon className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Back PNG</span>
                    </button>
                    <a
                      href={qr.pngDataUrl}
                      download={`${order.orderNumber}-qr.png`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>QR PNG</span>
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-50 border border-dashed border-slate-300 space-y-3">
                <p className="text-xs text-slate-600">
                  {order.designId === 'shop_direct'
                    ? 'Direct Shop product order. Generate a printable pack/tag QR reference if needed for fulfilment.'
                    : 'No production QR artifact is attached to this order yet. Generate it now to enable immediate 300 DPI PDF printing.'}
                </p>
                <button
                  type="button"
                  disabled={preparingPrint}
                  onClick={handlePrepareQrAndPrint}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>{preparingPrint ? 'Generating Print QR...' : 'Generate Print QR & Prepare Files'}</span>
                </button>
              </div>
            )}

            {design && (
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <div className="text-xs font-semibold text-[#0B1D3A]">
                  Card Artwork Proof ({design.dimensions} · {design.cardOrientation})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 mb-1">Front Side</div>
                    <CardCanvasPreview
                      side={design.frontDesign}
                      orientation={design.cardOrientation}
                      personalInfo={cardPersonalInfo}
                      actualQrPng={qr?.pngDataUrl}
                      showPrintGuides
                    />
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 mb-1">Back Side</div>
                    <CardCanvasPreview
                      side={design.backDesign}
                      orientation={design.cardOrientation}
                      personalInfo={cardPersonalInfo}
                      actualQrPng={qr?.pngDataUrl}
                      showPrintGuides
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
};

// 5. Payments, Card Templates, QR Management, Shipping, Reports, Settings, Audit Logs
export const AdminPaymentsPage: React.FC = () => {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  useEffect(() => { getAllPayments().then(setPayments); }, []);
  return (
    <PortalLayout portal="admin" title="Payment Transactions">
      <AdminOrdersHubTabs />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-3 px-4">Order ID</th>
              <th className="py-3 px-4">Gateway</th>
              <th className="py-3 px-4">Gateway Payment ID</th>
              <th className="py-3 px-4">Amount</th>
              <th className="py-3 px-4">Signature Verified</th>
              <th className="py-3 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payments.map((p) => (
              <tr key={p.paymentId}>
                <td className="py-3 px-4 font-mono">{p.orderId}</td>
                <td className="py-3 px-4">{p.gateway}</td>
                <td className="py-3 px-4 font-mono">{p.gatewayPaymentId || '—'}</td>
                <td className="py-3 px-4 font-mono tabular-nums font-semibold">₹{p.amount}</td>
                <td className="py-3 px-4">{p.signatureVerified ? 'Yes (HMAC-SHA256)' : 'No'}</td>
                <td className="py-3 px-4 font-semibold text-emerald-700">{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PortalLayout>
  );
};

export const AdminCardTemplatesPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify, confirmAction } = useToast();
  const [templates, setTemplates] = useState<CardTemplateRecord[]>(DEFAULT_CARD_TEMPLATES);
  const [name, setName] = useState('');
  const [priceInr, setPriceInr] = useState(999);
  const [newDesignTier, setNewDesignTier] = useState<'minimal' | 'designer'>('minimal');
  const [cardType, setCardType] = useState('Matte PVC SMART');
  const [category, setCategory] = useState('Executive');
  const [newProfileType, setNewProfileType] = useState<'all' | ProfileType>('all');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'all' | ProfileType>('ALL');
  const [description, setDescription] = useState('');
  const [bgColor, setBgColor] = useState('#0B1D3A');
  const [draftFrontBgImage, setDraftFrontBgImage] = useState('');
  const [draftBackBgImage, setDraftBackBgImage] = useState('');
  const [newActive, setNewActive] = useState(true);
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{ template: CardTemplateRecord; isNew: boolean } | null>(null);

  const load = () => getCardTemplates(true).then(setTemplates);
  useEffect(() => { load(); }, []);

  const enabledCount = templates.filter((t) => t.active).length;
  const activeDefaultTpl = templates.find((t) => t.isDefault) || templates.find((t) => t.active) || null;
  const visibleTemplatesList = templates.filter(
    (t) => typeFilter === 'ALL' || (t.profileType || 'all') === typeFilter
  );

  const buildNewTemplateDraft = (): CardTemplateRecord => {
    const base = DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === 'premium-navy') || DEFAULT_CARD_TEMPLATES[0];
    return {
      ...JSON.parse(JSON.stringify(base)),
      templateId: `tpl-${Date.now()}`,
      name: name.trim() || 'Untitled Smart Card',
      priceInr: Math.max(0, Number(priceInr) || 0),
      cardType: cardType.trim() || 'Matte PVC SMART',
      category: category.trim() || 'Executive',
      profileType: newProfileType,
      designTier: newDesignTier,
      pricingMode: 'card_tiers',
      description: description.trim(),
      active: newIsDefault ? true : newActive,
      isDefault: newIsDefault,
      supportsVertical: true,
      frontSpec: {
        ...JSON.parse(JSON.stringify(base.frontSpec)),
        backgroundColor: bgColor,
        gradientTo: '',
        backgroundImageUrl: draftFrontBgImage || '',
      },
      backSpec: {
        ...JSON.parse(JSON.stringify(base.backSpec)),
        backgroundImageUrl: draftBackBgImage || '',
      },
    };
  };

  const resetCreateForm = () => {
    setName('');
    setDescription('');
    setDraftFrontBgImage('');
    setDraftBackBgImage('');
    setNewActive(true);
    setNewIsDefault(false);
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord) return;
    const tpl = buildNewTemplateDraft();
    await saveCardTemplate(tpl, { uid: userRecord.uid, email: userRecord.email, role: userRecord.role });
    resetCreateForm();
    await load();
    notify(
      tpl.isDefault ? 'Template added & set as default' : 'Template added',
      tpl.name,
      'success'
    );
  };

  const handleSaveFromModal = async (cleaned: CardTemplateRecord) => {
    if (!userRecord) return;
    await saveCardTemplate(cleaned, { uid: userRecord.uid, email: userRecord.email, role: userRecord.role });
    if (modalState?.isNew) {
      resetCreateForm();
    }
    setModalState(null);
    await load();
    notify(modalState?.isNew ? 'Template created' : 'Template updated', cleaned.name, 'success');
  };

  const handleQuickUploadExistingBg = async (tpl: CardTemplateRecord, file: File) => {
    if (!userRecord) return;
    try {
      const compressed = await compressImageFileToDataUrl(file, {
        maxWidth: 1082,
        maxHeight: 709,
        maxChars: 260_000,
      });
      const updated: CardTemplateRecord = {
        ...tpl,
        frontSpec: { ...tpl.frontSpec, backgroundImageUrl: compressed },
      };
      await saveCardTemplate(updated, { uid: userRecord.uid, email: userRecord.email, role: userRecord.role });
      await load();
      notify('Background applied', `Updated Front artwork for ${tpl.name}`, 'success');
    } catch {
      notify('Upload failed', 'Could not read selected design image.', 'error');
    }
  };

  const handleToggleVisible = async (tpl: CardTemplateRecord, nextChecked: boolean) => {
    if (!userRecord) return;
    setBusyId(tpl.templateId);
    try {
      const nextTpl: CardTemplateRecord = {
        ...tpl,
        active: nextChecked,
        isDefault: !nextChecked && tpl.isDefault ? false : tpl.isDefault,
      };
      await saveCardTemplate(nextTpl, { uid: userRecord.uid, email: userRecord.email, role: userRecord.role });
      await load();
      notify(
        nextChecked ? 'Template enabled for users' : 'Template hidden from users',
        tpl.name,
        nextChecked ? 'success' : 'info'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSetDefault = async (tpl: CardTemplateRecord) => {
    if (!userRecord) return;
    setBusyId(tpl.templateId);
    try {
      await setDefaultCardTemplate(tpl.templateId, {
        uid: userRecord.uid,
        email: userRecord.email,
        role: userRecord.role,
      });
      await load();
      notify('Default template updated', `${tpl.name} is now the default template for users.`, 'success');
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkVisibility = async (enableAll: boolean) => {
    if (!userRecord) return;
    setBusyId('__bulk__');
    try {
      await setBulkCardTemplatesVisibility(enableAll, {
        uid: userRecord.uid,
        email: userRecord.email,
        role: userRecord.role,
      });
      await load();
      notify(
        enableAll ? 'All templates enabled' : 'All templates disabled',
        enableAll
          ? 'Every template in the catalog is now visible in Customer Design Studio.'
          : 'Predefined templates are now unchecked. Check only the templates you want users to see.',
        'info'
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PortalLayout portal="admin" title="Card Templates Management">
      <AdminCardsHubTabs />
      <div className="space-y-6">
        {/* Catalog Visibility & Default Summary Bar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CheckSquare className="h-4 w-4 text-[#1D4ED8]" />
              <h2 className="font-display font-bold text-sm sm:text-base text-[#0B1D3A]">
                Customer Template Visibility &amp; Default Selection
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              Check the templates below to make them visible in Customer Design Studio. Only checked templates ({' '}
              <strong className="text-[#0B1D3A]">
                {enabledCount} of {templates.length}
              </strong>{' '}
              ) are shown to users. Current Default:{' '}
              <strong className="text-amber-700">{activeDefaultTpl?.name || 'None'}</strong>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busyId === '__bulk__'}
              onClick={() => handleBulkVisibility(true)}
              className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold disabled:opacity-50"
            >
              Check All ({templates.length})
            </button>
            <button
              type="button"
              disabled={busyId === '__bulk__'}
              onClick={() => handleBulkVisibility(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold disabled:opacity-50"
            >
              Uncheck All
            </button>
          </div>
        </div>

        {/* Add New Template Form */}
        <form onSubmit={handleQuickAdd} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display font-bold text-sm text-[#0B1D3A]">Add New Card Template</h3>
            <span className="text-[11px] text-slate-500">Upload custom artwork or design layout &amp; set default</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Template Name *</label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Healthcare Aqua Pro"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Price (INR) *</label>
              <input
                type="number"
                required
                min={0}
                value={priceInr}
                onChange={(e) => setPriceInr(Number(e.target.value))}
                placeholder="1350"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Card Finish / Type</label>
              <input
                type="text"
                maxLength={80}
                value={cardType}
                onChange={(e) => setCardType(e.target.value)}
                placeholder="Matte PVC SMART"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Category</label>
              <input
                type="text"
                maxLength={60}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Executive"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Card Base Color</label>
              <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-full h-9 rounded border border-slate-300 cursor-pointer" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-4">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Description</label>
              <input
                type="text"
                maxLength={400}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description of finish, target audience, and SMART compatibility..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div className="lg:col-span-4 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                <Upload className="h-3.5 w-3.5 text-[#1D4ED8]" />
                <span>{draftFrontBgImage ? 'Change Front BG' : 'Front BG Image'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    const dataUrl = await compressImageFileToDataUrl(f, {
                      maxWidth: 1082,
                      maxHeight: 709,
                      maxChars: 260_000,
                    });
                    setDraftFrontBgImage(dataUrl);
                    notify('Front background attached', 'Open "Customize Layout" to adjust text/QR over your image.', 'info');
                  }}
                />
              </label>
              <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                <Upload className="h-3.5 w-3.5 text-emerald-700" />
                <span>{draftBackBgImage ? 'Change Back BG' : 'Back BG Image'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    const dataUrl = await compressImageFileToDataUrl(f, {
                      maxWidth: 1082,
                      maxHeight: 709,
                      maxChars: 260_000,
                    });
                    setDraftBackBgImage(dataUrl);
                    notify('Back background attached', 'Back artwork added to your new template.', 'info');
                  }}
                />
              </label>
              {(draftFrontBgImage || draftBackBgImage) && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftFrontBgImage('');
                    setDraftBackBgImage('');
                  }}
                  className="text-xs text-rose-600 hover:underline"
                >
                  Clear Images
                </button>
              )}
            </div>
            <div className="lg:col-span-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalState({ template: buildNewTemplateDraft(), isNew: true })}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-[#1D4ED8] text-[#1D4ED8] bg-blue-50/70 hover:bg-blue-100 rounded-lg text-xs font-semibold"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Customize Layout Before Saving</span>
              </button>
              <button type="submit" className="px-4 py-2 bg-[#0B1D3A] hover:bg-[#132A52] text-white rounded-lg text-xs font-semibold">
                Add Card Template
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-5">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newIsDefault ? true : newActive}
                  disabled={newIsDefault}
                  onChange={(e) => setNewActive(e.target.checked)}
                  className="h-4 w-4 accent-[#1D4ED8]"
                />
                <span>Enable immediately for users</span>
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1D3A] cursor-pointer">
                <input
                  type="checkbox"
                  checked={newIsDefault}
                  onChange={(e) => {
                    setNewIsDefault(e.target.checked);
                    if (e.target.checked) setNewActive(true);
                  }}
                  className="h-4 w-4 accent-amber-600"
                />
                <span>Make this the Default Template for users</span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-medium text-slate-500">Pricing Tier:</label>
                <select
                  value={newDesignTier}
                  onChange={(e) => {
                    const tier = e.target.value as 'minimal' | 'designer';
                    setNewDesignTier(tier);
                    setPriceInr(tier === 'minimal' ? 999 : 1499);
                  }}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="minimal">Minimal Design (₹499 QR / ₹999 Smart)</option>
                  <option value="designer">Designer Card (₹599 QR / ₹1,499 Smart)</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-medium text-slate-500">Target Profile Type:</label>
                <select
                  value={newProfileType}
                  onChange={(e) => setNewProfileType(e.target.value as 'all' | ProfileType)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="all">All Profile Types</option>
                  <option value="adult">Adult / Business</option>
                  <option value="kids">Kids Safety</option>
                  <option value="pets">Pets Recovery</option>
                  <option value="belongings">Personal Belongings</option>
                </select>
              </div>
            </div>
          </div>
        </form>

        {/* Template Type Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-2xl p-3">
          <span className="text-xs font-semibold text-slate-600 px-1">Filter by Profile Type:</span>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'ALL', label: `All (${templates.length})` },
                { id: 'all', label: 'Universal' },
                { id: 'adult', label: 'Adult' },
                { id: 'kids', label: 'Kids' },
                { id: 'pets', label: 'Pets' },
                { id: 'belongings', label: 'Belongings' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTypeFilter(f.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  typeFilter === f.id
                    ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleTemplatesList.map((t) => (
            <div
              key={t.templateId}
              className={`bg-white border rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4 transition-colors ${
                t.isDefault
                  ? 'border-amber-400 ring-1 ring-amber-200'
                  : t.active
                  ? 'border-slate-200'
                  : 'border-slate-200 bg-slate-50/70 opacity-85'
              }`}
            >
              <div className="space-y-3">
                {/* Top Checkbox + Default Indicator */}
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={t.active}
                      disabled={busyId === t.templateId}
                      onChange={(e) => handleToggleVisible(t, e.target.checked)}
                      className="h-4 w-4 accent-[#1D4ED8] rounded"
                    />
                    <span>{t.active ? 'Visible to Users' : 'Hidden from Users'}</span>
                  </label>

                  {t.isDefault ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-600" />
                      <span>Default</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === t.templateId}
                      onClick={() => handleSetDefault(t)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 hover:border-amber-400 hover:bg-amber-50 text-[11px] font-semibold text-slate-700 hover:text-amber-800 disabled:opacity-50"
                    >
                      <Star className="h-3 w-3" />
                      <span>Set as Default</span>
                    </button>
                  )}
                </div>

                {/* Live Card Miniature Preview */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                  <CardCanvasPreview
                    side={t.frontSpec}
                    orientation="landscape"
                    personalInfo={{
                      fullName: 'Your Name',
                      jobTitle: 'Your Designation',
                      companyName: 'Your Company Name',
                      mobile: 'Your Number',
                      email: 'Your Email ID',
                      website: 'Your Website',
                    }}
                  />
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-sm text-[#0B1D3A] truncate">{t.name}</h3>
                    <p className="text-xs text-slate-500">
                      {t.cardType} · {t.category || 'Standard'}
                      {t.profileType && t.profileType !== 'all' ? ` · ${t.profileType.toUpperCase()}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-xs font-bold text-[#1D4ED8] block">
                      {t.pricingMode === 'fixed_pack'
                        ? `₹${resolveCardPricing(t).unitPriceInr}`
                        : `₹${resolveCardPricing(t, 'qr_only').unitPriceInr} / ₹${resolveCardPricing(t, 'qr_smart').unitPriceInr}`}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {t.pricingMode === 'fixed_pack'
                        ? 'Pack of 2'
                        : resolveCardPricing(t).designTier === 'minimal'
                          ? 'Minimal'
                          : 'Designer'}
                    </span>
                  </div>
                </div>
                {t.description ? (
                  <p className="text-xs text-slate-600 line-clamp-2">{t.description}</p>
                ) : (
                  <p className="text-[11px] text-slate-400 italic">No description added yet.</p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between pt-3 border-t border-slate-100 gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setModalState({ template: JSON.parse(JSON.stringify(t)) as CardTemplateRecord, isNew: false })}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B1D3A] hover:text-[#1D4ED8]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>Edit &amp; Design</span>
                  </button>
                  <label className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-[#1D4ED8] cursor-pointer">
                    <ImageIcon className="h-3.5 w-3.5" />
                    <span>{t.frontSpec.backgroundImageUrl ? 'Change BG' : 'Add BG'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) handleQuickUploadExistingBg(t, f);
                      }}
                    />
                  </label>
                </div>

                {userRecord?.role === 'SUPERADMIN' && (
                  <button
                    type="button"
                    title="Delete template"
                    aria-label={`Delete ${t.name}`}
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: 'Delete Card Template',
                        message: `Remove "${t.name}" from the card catalog?`,
                        destructive: true,
                        confirmLabel: 'Delete Template',
                      });
                      if (!ok) return;
                      await deleteCardTemplate(t.templateId, { uid: userRecord.uid, email: userRecord.email, role: userRecord.role });
                      await load();
                      notify('Template deleted', t.name, 'success');
                    }}
                    className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Visual Card Template Studio Modal (New & Existing Templates) */}
      {modalState && (
        <TemplateVisualEditorModal
          initialTemplate={modalState.template}
          isNew={modalState.isNew}
          onClose={() => setModalState(null)}
          onSave={handleSaveFromModal}
        />
      )}
    </PortalLayout>
  );
};

export const AdminQrManagementPage: React.FC = () => {
  const [qrs, setQrs] = useState<QrCodeRecord[]>([]);
  useEffect(() => { getAllQrCodes().then(setQrs); }, []);
  return (
    <PortalLayout portal="admin" title="QR Code Registry">
      <AdminOpsHubTabs />
      <div className="space-y-4">
        <div className="flex justify-end">
          <Link to="/superadmin/qr-generator" className="px-4 py-2 bg-[#0B1D3A] text-white text-xs font-semibold rounded-lg">
            Open SuperAdmin URL QR Generator
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {qrs.map((q) => (
            <div key={q.qrCodeId} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
              {q.pngDataUrl && <img src={q.pngDataUrl} alt={q.qrCodeId} className="w-20 h-20 border border-slate-200 rounded" />}
              <div className="min-w-0 flex-1 text-xs space-y-1">
                <div className="font-semibold text-[#0B1D3A]">{q.qrType}</div>
                <div className="font-mono text-slate-500 truncate">{q.targetUrl}</div>
                <div className="flex gap-2 pt-1">
                  {q.pngDataUrl && (
                    <a href={q.pngDataUrl} download={`${q.qrCodeId}.png`} className="text-[#1D4ED8] font-semibold hover:underline">
                      PNG
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([q.svgContent], { type: 'image/svg+xml' });
                      downloadBlob(blob, `${q.qrCodeId}.svg`);
                    }}
                    className="text-[#1D4ED8] font-semibold hover:underline"
                  >
                    SVG
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PortalLayout>
  );
};

export const AdminShippingPage: React.FC = () => {
  const [records, setRecords] = useState<ShippingRecord[]>([]);
  useEffect(() => { getAllShippingRecords().then(setRecords); }, []);
  return (
    <PortalLayout portal="admin" title="Shipping & Dispatch Tracking">
      <AdminOrdersHubTabs />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-3 px-4">Order ID</th>
              <th className="py-3 px-4">Courier</th>
              <th className="py-3 px-4">Tracking Number</th>
              <th className="py-3 px-4">Dispatch Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((r) => (
              <tr key={r.shippingId}>
                <td className="py-3 px-4 font-mono">{r.orderId}</td>
                <td className="py-3 px-4 font-semibold">{r.courierName}</td>
                <td className="py-3 px-4 font-mono">{r.trackingNumber}</td>
                <td className="py-3 px-4 font-mono">{r.dispatchDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PortalLayout>
  );
};

export const AdminReportsPage: React.FC = () => {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  useEffect(() => { Promise.all([getAllOrders(), getAllUsers()]).then(([o, u]) => { setOrders(o); setUsers(u); }); }, []);

  return (
    <PortalLayout portal="admin" title="Reports & Analytics Export">
      <AdminOpsHubTabs />
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <h2 className="font-display font-bold text-base text-[#0B1D3A]">Export Platform Reports (CSV / Excel)</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() =>
              exportRowsToExcel(
                'tapnex-sales-report.xlsx',
                'Sales',
                orders.map((o) => ({
                  orderNumber: o.orderNumber,
                  customer: o.shippingAddress.fullName,
                  city: o.shippingAddress.city,
                  state: o.shippingAddress.state,
                  subtotal: o.subtotal || 0,
                  tax: o.tax || 0,
                  shipping: o.shipping || 0,
                  total: o.total,
                  paymentStatus: o.paymentStatus,
                  orderStatus: o.orderStatus,
                }))
              )
            }
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0B1D3A] text-white text-xs font-semibold rounded-xl"
          >
            <Download className="h-4 w-4" />
            <span>Export Sales & Revenue (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={() =>
              exportRowsToCsv(
                'tapnex-users-report.csv',
                users.map((u) => ({ uid: u.uid, email: u.email, role: u.role, status: u.status }))
              )
            }
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-slate-300 text-xs font-semibold rounded-xl"
          >
            <Download className="h-4 w-4" />
            <span>Export Users (.csv)</span>
          </button>
        </div>
      </div>
    </PortalLayout>
  );
};

export const AdminSettingsAndTicketsPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify } = useToast();
  const location = useLocation();
  const initialSubTab =
    new URLSearchParams(location.search).get('tab') === 'tickets' ? 'tickets' : 'gateways';
  const [subTab, setSubTab] = useState<'gateways' | 'tickets'>(initialSubTab);
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [templates, setTemplates] = useState<EmailTemplateRecord[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<EmailTemplateRecord | null>(null);

  useEffect(() => {
    const param = new URLSearchParams(location.search).get('tab');
    if (param === 'tickets' || param === 'gateways') setSubTab(param);
  }, [location.search]);

  const load = () => {
    getSupportTickets().then(setTickets);
    getEmailTemplates().then((list) => {
      setTemplates(list);
      setSelectedTpl(list[0] || null);
    });
  };
  useEffect(() => { load(); }, []);

  return (
    <PortalLayout portal="admin" title="Payment Gateways, Support & Email">
      <AdminOpsHubTabs />

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSubTab('gateways')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border transition-colors ${
            subTab === 'gateways'
              ? 'bg-[#1D4ED8] text-white border-[#1D4ED8]'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          }`}
        >
          <CreditCard className="h-3.5 w-3.5" />
          <span>Payment Gateways (6 Providers)</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('tickets')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border transition-colors ${
            subTab === 'tickets'
              ? 'bg-[#1D4ED8] text-white border-[#1D4ED8]'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          }`}
        >
          <span>Support Tickets & Email Templates ({tickets.length})</span>
        </button>
      </div>

      {subTab === 'gateways' ? (
        <PaymentGatewaySettingsPanel />
      ) : (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="font-display font-bold text-base text-[#0B1D3A]">Customer Support Tickets</h2>
            {tickets.length === 0 ? (
              <p className="text-xs text-slate-500">No support tickets logged.</p>
            ) : (
              <div className="space-y-3">
                {tickets.map((t) => (
                  <div key={t.ticketId} className="p-4 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>{t.category} · UID: {t.uid.slice(0, 8)}</span>
                      <span className="font-semibold text-[#1D4ED8]">{t.status}</span>
                    </div>
                    <div className="font-semibold text-sm text-[#0B1D3A]">{t.subject}</div>
                    <p className="text-xs text-slate-600">{t.message}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await updateSupportTicket(t.ticketId, { status: 'Resolved', adminReply: 'Reviewed and resolved by support team.' });
                          notify('Ticket resolved', t.subject, 'success');
                          load();
                        }}
                        className="px-3 py-1.5 bg-[#0B1D3A] text-white text-xs font-semibold rounded-lg"
                      >
                        Mark Resolved
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedTpl && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <h2 className="font-display font-bold text-base text-[#0B1D3A]">Transactional Email Templates</h2>
              <select
                value={selectedTpl.templateId}
                onChange={(e) => setSelectedTpl(templates.find((t) => t.templateId === e.target.value) || null)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              >
                {templates.map((t) => (
                  <option key={t.templateId} value={t.templateId}>{t.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={selectedTpl.subject}
                onChange={(e) => setSelectedTpl({ ...selectedTpl, subject: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
              <textarea
                rows={6}
                value={selectedTpl.htmlBody}
                onChange={(e) => setSelectedTpl({ ...selectedTpl, htmlBody: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
              />
              {userRecord?.role === 'SUPERADMIN' && (
                <button
                  type="button"
                  onClick={async () => {
                    await saveEmailTemplate(selectedTpl, { uid: userRecord.uid, email: userRecord.email, role: userRecord.role });
                    notify('Email template saved', selectedTpl.name, 'success');
                  }}
                  className="px-4 py-2 bg-[#0B1D3A] text-white text-xs font-semibold rounded-lg"
                >
                  Save Email Template
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </PortalLayout>
  );
};

const KNOWN_AUDIT_ACTIONS = [
  'SAVE_CARD_TEMPLATE',
  'DELETE_CARD_TEMPLATE',
  'DELETE_CARD_DESIGN',
  'DELETE_DIGITAL_PROFILE',
  'ADMIN_TOGGLE_PROFILE',
  'UPDATE_USER',
  'UPDATE_PAYMENT_STATUS',
  'UPDATE_ORDER_WORKFLOW',
  'UPDATE_EMAIL_TEMPLATE',
];

export const AdminAuditLogsPage: React.FC = () => {
  const { notify } = useToast();
  const [rawLogs, setRawLogs] = useState<AuditLogRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasAppliedFilter, setHasAppliedFilter] = useState(false);

  const [preset, setPreset] = useState<AuditLogPreset>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [keyword, setKeyword] = useState('');

  const availableActions = useMemo(() => {
    const set = new Set<string>(KNOWN_AUDIT_ACTIONS);
    if (rawLogs) {
      for (const l of rawLogs) {
        if (l.action) set.add(l.action);
      }
    }
    return Array.from(set).sort();
  }, [rawLogs]);

  const fetchAndShowLogs = async (nextPreset: AuditLogPreset) => {
    if (!nextPreset && !fromDate && !toDate && roleFilter === 'ALL' && actionFilter === 'ALL' && !keyword.trim()) {
      notify('Select a filter first', 'Choose All Logs, a date range, role, action, or enter a keyword.', 'info');
      return;
    }
    setLoading(true);
    try {
      const loaded = rawLogs ?? (await getAuditLogs(300));
      setRawLogs(loaded);
      setHasAppliedFilter(true);
    } catch (err) {
      notify('Failed to load audit logs', err instanceof Error ? err.message : 'Unable to query audit logs.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePresetChange = async (value: AuditLogPreset) => {
    setPreset(value);
    if (!value) {
      setHasAppliedFilter(false);
      return;
    }
    if (value !== 'CUSTOM') {
      await fetchAndShowLogs(value);
    }
  };

  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectivePreset: AuditLogPreset =
      fromDate || toDate ? 'CUSTOM' : preset || 'ALL';
    if (!preset) setPreset(effectivePreset);
    await fetchAndShowLogs(effectivePreset);
  };

  const handleReset = () => {
    setPreset('');
    setFromDate('');
    setToDate('');
    setRoleFilter('ALL');
    setActionFilter('ALL');
    setKeyword('');
    setHasAppliedFilter(false);
  };

  const filteredLogs = useMemo(() => {
    if (!hasAppliedFilter || !rawLogs) return [];
    const effectivePreset: AuditLogPreset =
      fromDate || toDate ? 'CUSTOM' : preset || 'ALL';
    return filterAuditLogs(rawLogs, {
      preset: effectivePreset,
      fromDate,
      toDate,
      role: roleFilter,
      action: actionFilter,
      keyword,
    });
  }, [hasAppliedFilter, rawLogs, preset, fromDate, toDate, roleFilter, actionFilter, keyword]);

  return (
    <PortalLayout portal="admin" title="Security & Administrative Audit Logs">
      <AdminOpsHubTabs />
      <div className="space-y-5">
        <form onSubmit={handleApplySubmit} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-display font-bold text-[#0B1D3A]">
              <Filter className="h-4 w-4 text-[#1D4ED8]" />
              <span>Filter Audit Logs</span>
            </div>
            {hasAppliedFilter && (
              <span className="text-xs font-mono text-slate-500">
                Showing {filteredLogs.length} matching log{filteredLogs.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Preset / Scope</label>
              <select
                value={preset}
                onChange={(e) => handlePresetChange(e.target.value as AuditLogPreset)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              >
                <option value="">-- Select Filter --</option>
                <option value="ALL">All Audit Logs</option>
                <option value="LAST_24H">Last 24 Hours</option>
                <option value="LAST_7D">Last 7 Days</option>
                <option value="LAST_30D">Last 30 Days</option>
                <option value="CUSTOM">Custom Date Range (From / To)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  if (e.target.value) setPreset('CUSTOM');
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  if (e.target.value) setPreset('CUSTOM');
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Actor Role</label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              >
                <option value="ALL">All Roles</option>
                <option value="USER">Customer (USER)</option>
                <option value="PRINTER">Printer (PRINTER)</option>
                <option value="ADMIN">Admin (ADMIN)</option>
                <option value="SUPERADMIN">SuperAdmin (SUPERADMIN)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Action Type</label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              >
                <option value="ALL">All Actions</option>
                {availableActions.map((act) => (
                  <option key={act} value={act}>
                    {act}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Keyword</label>
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Email, target, details..."
                  className="w-full pl-8 pr-2.5 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0B1D3A] hover:bg-[#132A52] text-white text-xs font-semibold rounded-lg disabled:opacity-50"
            >
              <Filter className="h-3.5 w-3.5" />
              <span>{loading ? 'Loading Logs...' : 'Apply Filter & Show Logs'}</span>
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-lg"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset / Hide Logs</span>
            </button>
            {hasAppliedFilter && (
              <button
                type="button"
                onClick={async () => {
                  setLoading(true);
                  try {
                    const fresh = await getAuditLogs(300);
                    setRawLogs(fresh);
                  } finally {
                    setLoading(false);
                  }
                }}
                className="text-xs font-semibold text-[#1D4ED8] hover:underline ml-auto"
              >
                Refresh Logs
              </button>
            )}
          </div>
        </form>

        {!hasAppliedFilter ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center space-y-2">
            <Filter className="h-7 w-7 text-slate-400 mx-auto" />
            <div className="font-display font-bold text-sm text-[#0B1D3A]">
              Audit logs are hidden until you select a filter
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Select a preset such as <strong>All Audit Logs</strong> or <strong>Last 24 Hours</strong>, enter a <strong>From / To</strong> date range, or search by <strong>Keyword</strong> and click <strong>Apply Filter &amp; Show Logs</strong>.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Target</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      Loading audit logs...
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      No audit log entries matched your selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((l) => (
                    <tr key={l.logId}>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {formatTimestampDate(l.createdAt)}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-[#0B1D3A] whitespace-nowrap">{l.action}</td>
                      <td className="py-3 px-4 whitespace-nowrap">{l.actorEmail || l.actorUid} ({l.actorRole})</td>
                      <td className="py-3 px-4 font-mono whitespace-nowrap">{l.targetCollection}/{l.targetId}</td>
                      <td className="py-3 px-4 text-slate-600">{l.details || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PortalLayout>
  );
};

// 6. Admin / SuperAdmin Digital Profiles Management (Enable/Disable + Delete)
export const AdminProfilesPage: React.FC = () => {
  const { userRecord, appSettings } = useAuth();
  const { notify, confirmAction } = useToast();
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED' | 'APPROVED'>('ALL');
  const [loading, setLoading] = useState(true);
  const [inspectedProfile, setInspectedProfile] = useState<ProfileRecord | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([getAllProfiles(), getAllUsers(), getAllOrders()])
      .then(([profs, usrs, ords]) => {
        setProfiles(profs);
        setUsers(usrs);
        setOrders(ords);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const userMap = useMemo(() => {
    const map = new Map<string, UserRecord>();
    for (const u of users) map.set(u.uid, u);
    return map;
  }, [users]);

  const filtered = profiles.filter((p) => {
    const owner = userMap.get(p.uid);
    const q = search.toLowerCase();
    const matchText =
      !q ||
      p.slug.toLowerCase().includes(q) ||
      (p.profileLabel || '').toLowerCase().includes(q) ||
      (p.personalInformation.fullName || '').toLowerCase().includes(q) ||
      (owner?.email || '').toLowerCase().includes(q);
    const matchState =
      stateFilter === 'ALL' ||
      (stateFilter === 'ACTIVE' && p.isPublic) ||
      (stateFilter === 'DISABLED' && !p.isPublic) ||
      (stateFilter === 'APPROVED' && Boolean(p.adminApproved));
    return matchText && matchState;
  });

  const handleToggleApproval = async (p: ProfileRecord) => {
    if (!userRecord) return;
    const updated = await adminSetProfileApproval({
      profile: p,
      approved: !p.adminApproved,
      actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
      inactiveMessage: appSettings.inactiveProfileMessage,
    });
    notify(
      updated.adminApproved ? 'Profile link approved (payment optional)' : 'Manual approval revoked',
      `/p/${p.slug}`,
      'success'
    );
    setInspectedProfile((curr) => (curr?.profileId === p.profileId ? updated : curr));
    load();
  };

  const handleToggleActive = async (p: ProfileRecord) => {
    if (!userRecord) return;
    const nextPublic = !(p.isPublic && !p.adminDisabled);
    const updated = await adminToggleProfileStatus({
      profile: p,
      isPublic: nextPublic,
      actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
      inactiveMessage: appSettings.inactiveProfileMessage,
    });
    notify(nextPublic ? 'Profile link enabled' : 'Profile link disabled', `/p/${p.slug}`, 'success');
    setInspectedProfile((curr) =>
      curr?.profileId === p.profileId ? updated : curr
    );
    load();
  };

  const handleMarkPaymentCompleted = async (p: ProfileRecord, completed: boolean) => {
    if (!userRecord) return;
    const ok = await confirmAction({
      title: completed ? 'Reconcile Profile Payment' : 'Revoke Profile Payment Status',
      message: completed
        ? `Confirm payment reconciliation for /p/${p.slug}? This unlocks the public profile via server Cloud Function and creates an audit log.`
        : `Clear payment confirmation status for /p/${p.slug}?`,
      destructive: !completed,
      confirmLabel: completed ? 'Confirm Reconciliation' : 'Revoke Payment',
    });
    if (!ok) return;
    try {
      const res = await adminReconcileProfilePayment({
        profileId: p.profileId,
        completed,
        reason: completed
          ? 'Admin reconciled profile payment from Profiles Control'
          : 'Admin revoked profile payment from Profiles Control',
      });
      const updated: ProfileRecord = {
        ...p,
        paymentConfirmed: res.paymentConfirmed,
        paymentCompletedAt: res.paymentCompletedAt,
        paymentReference: res.paymentReference,
        isPublic: res.isPublic,
      };
      notify(
        completed ? 'Payment reconciled' : 'Payment status cleared',
        `/p/${p.slug}`,
        'success'
      );
      setInspectedProfile((curr) =>
        curr?.profileId === p.profileId ? updated : curr
      );
      load();
    } catch (err) {
      notify(
        'Payment reconciliation failed',
        err instanceof Error ? err.message : 'Unable to reconcile profile payment.',
        'error'
      );
    }
  };

  return (
    <PortalLayout portal="admin" title="Digital Profiles Control">
      <AdminUsersHubTabs />
      <div className="space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2.5 flex-1">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by slug, name, or owner email..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as 'ALL' | 'ACTIVE' | 'DISABLED' | 'APPROVED')}
              className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Enabled / Public</option>
              <option value="APPROVED">Admin Approved (No Payment)</option>
              <option value="DISABLED">Disabled</option>
            </select>
          </div>
          <div className="text-xs font-mono text-slate-500">
            Showing {filtered.length} of {profiles.length} profiles
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-3 px-4">Profile / Owner</th>
                <th className="py-3 px-4">Public Slug</th>
                <th className="py-3 px-4">Payment / Link Unlock</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">Loading digital profiles...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">No digital profiles matched.</td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const owner = userMap.get(p.uid);
                  const paid =
                    Boolean(p.paymentConfirmed) ||
                    isOrderPaymentConfirmed(orders, p.profileId, p.slug);
                  return (
                    <tr key={p.profileId}>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#0B1D3A] flex items-center gap-1.5">
                          <span>{p.personalInformation.fullName || p.profileLabel || p.slug}</span>
                          {p.profileType && p.profileType !== 'adult' && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-semibold uppercase">
                              {p.profileType}
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500">{owner?.email || p.uid}</div>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <a
                          href={`/p/${p.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#1D4ED8] hover:underline"
                        >
                          <span>/p/{p.slug}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                      <td className="py-3 px-4 space-y-1">
                        <div className={`font-semibold ${paid ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {paid ? 'Payment: Confirmed' : 'Payment: Pending'}
                        </div>
                        {p.adminApproved && (
                          <div className="inline-block px-2 py-0.5 rounded bg-blue-50 text-[#1D4ED8] border border-blue-200 text-[10px] font-semibold">
                            Admin Approved
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`font-semibold ${p.isPublic && !p.adminDisabled ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {p.adminDisabled ? 'Disabled by Admin' : p.isPublic ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setInspectedProfile(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#1D4ED8]/30 bg-blue-50/70 text-[#1D4ED8] rounded-lg text-xs font-semibold hover:bg-blue-100"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Inspect Profile</span>
                        </button>
                        {!p.paymentConfirmed && (
                          <button
                            type="button"
                            onClick={() => handleMarkPaymentCompleted(p, true)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1D4ED8] hover:bg-blue-700 text-white text-xs font-semibold"
                          >
                            <CreditCard className="h-3.5 w-3.5" />
                            <span>Mark Paid</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleApproval(p)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                            p.adminApproved
                              ? 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          }`}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          <span>{p.adminApproved ? 'Revoke Approval' : 'Approve Link'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-50"
                        >
                          <Power className="h-3.5 w-3.5" />
                          <span>{p.isPublic && !p.adminDisabled ? 'Disable Link' : 'Enable Link'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!userRecord) return;
                            const ok = await confirmAction({
                              title: 'Delete Digital Profile',
                              message: `Permanently delete profile /p/${p.slug} belonging to ${owner?.email || p.uid}?`,
                              destructive: true,
                              confirmLabel: 'Delete Profile',
                            });
                            if (!ok) return;
                            await deleteDigitalProfile({
                              profile: p,
                              actor: { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
                            });
                            notify('Digital profile deleted', `/p/${p.slug}`, 'success');
                            load();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-rose-200 text-rose-600 rounded-lg text-xs font-semibold hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {inspectedProfile && (
        <AdminProfileInspectorModal
          profile={inspectedProfile}
          owner={userMap.get(inspectedProfile.uid) || null}
          paid={
            Boolean(inspectedProfile.paymentConfirmed) ||
            isOrderPaymentConfirmed(orders, inspectedProfile.profileId, inspectedProfile.slug)
          }
          onClose={() => setInspectedProfile(null)}
          onToggleApproval={handleToggleApproval}
          onToggleActive={handleToggleActive}
          onMarkPaymentCompleted={handleMarkPaymentCompleted}
        />
      )}
    </PortalLayout>
  );
};

// 7. Admin / SuperAdmin Approved Designs Directory + Direct-to-Print Dispatch
export const AdminApprovedDesignsPage: React.FC = () => {
  const { userRecord, appSettings } = useAuth();
  const { notify, confirmAction } = useToast();
  const [designs, setDesigns] = useState<CardDesignRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [printers, setPrinters] = useState<PrinterRecord[]>([]);
  const [templates, setTemplates] = useState<CardTemplateRecord[]>(DEFAULT_CARD_TEMPLATES);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Direct Send-to-Print Modal State
  const [printTarget, setPrintTarget] = useState<{
    design: CardDesignRecord;
    owner: UserRecord | null;
    prof: ProfileRecord | null;
    linkedOrder: OrderRecord | null;
  } | null>(null);
  const [printPrinterId, setPrintPrinterId] = useState('admin_inhouse');
  const [printInitialStatus, setPrintInitialStatus] = useState<OrderStatus>('Assigned to Printer');
  const [printQuantity, setPrintQuantity] = useState(1);
  const [printCardType, setPrintCardType] = useState('Matte PVC SMART');
  const [printEstimatedUnitPrice, setPrintEstimatedUnitPrice] = useState(999);
  const [printComplimentary, setPrintComplimentary] = useState(false);
  const [printComplimentaryReason, setPrintComplimentaryReason] = useState('');
  const [printNotes, setPrintNotes] = useState('');
  const [printShipping, setPrintShipping] = useState<ShippingAddress>({
    fullName: '',
    mobile: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: 'Maharashtra',
    pinCode: '',
    country: 'India',
  });
  const [submittingPrint, setSubmittingPrint] = useState(false);
  const [printResult, setPrintResult] = useState<{
    orderId: string;
    orderNumber: string;
    qrRecord: QrCodeRecord;
    design: CardDesignRecord;
    info: Partial<PersonalInformation>;
  } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      getAllCardDesigns(),
      getAllUsers(),
      getAllProfiles(),
      getAllOrders(),
      getAllPrinters(),
      getCardTemplates(true),
    ])
      .then(([des, usrs, profs, ords, prts, tpls]) => {
        setDesigns(des.filter((d) => d.approved));
        setUsers(usrs);
        setProfiles(profs);
        setOrders(ords);
        setPrinters(prts);
        if (tpls.length > 0) setTemplates(tpls);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const userMap = useMemo(() => {
    const m = new Map<string, UserRecord>();
    for (const u of users) m.set(u.uid, u);
    return m;
  }, [users]);

  const profileMap = useMemo(() => {
    const m = new Map<string, ProfileRecord>();
    for (const p of profiles) m.set(p.profileId, p);
    return m;
  }, [profiles]);

  const filtered = designs.filter((d) => {
    const owner = userMap.get(d.uid);
    const prof = profileMap.get(d.profileId);
    const q = search.toLowerCase();
    return (
      !q ||
      (owner?.displayName || '').toLowerCase().includes(q) ||
      (owner?.email || '').toLowerCase().includes(q) ||
      (prof?.slug || '').toLowerCase().includes(q) ||
      (prof?.personalInformation.fullName || '').toLowerCase().includes(q)
    );
  });

  const openSendToPrintModal = (
    design: CardDesignRecord,
    owner: UserRecord | null,
    prof: ProfileRecord | null,
    linkedOrder: OrderRecord | null
  ) => {
    const tpl = templates.find((t) => t.templateId === design.templateId) || templates[0];
    const info = prof?.personalInformation;
    const isPaid =
      linkedOrder?.paymentStatus === 'Verified' ||
      linkedOrder?.paymentStatus === 'Completed';

    setPrintResult(null);
    setPrintPrinterId(linkedOrder?.printerId || 'admin_inhouse');
    setPrintInitialStatus(
      linkedOrder && ORDER_STATUS_FLOW.indexOf(linkedOrder.orderStatus) >= ORDER_STATUS_FLOW.indexOf('Assigned to Printer')
        ? linkedOrder.orderStatus
        : 'Assigned to Printer'
    );
    const resolvedPricing = resolveCardPricing(
      tpl,
      design.cardTechnology || (design.frontDesign?.showNfcIcon ? 'qr_smart' : 'qr_only')
    );
    setPrintQuantity(linkedOrder?.quantity || 1);
    setPrintCardType(linkedOrder?.cardType || resolvedPricing.cardTypeLabel || tpl?.cardType || 'Matte PVC SMART');
    setPrintEstimatedUnitPrice(resolvedPricing.unitPriceInr || tpl?.priceInr || appSettings.baseCardPriceInr || 999);
    setPrintComplimentary(false);
    setPrintComplimentaryReason('');
    setPrintNotes(linkedOrder?.internalNotes || 'Dispatched directly from Approved Card Designs');
    setPrintShipping({
      fullName: linkedOrder?.shippingAddress.fullName || info?.fullName || owner?.displayName || 'Customer',
      mobile: linkedOrder?.shippingAddress.mobile || info?.mobile || owner?.phone || '9999999999',
      email: linkedOrder?.shippingAddress.email || info?.email || owner?.email || 'support@tapnex.in',
      addressLine1: linkedOrder?.shippingAddress.addressLine1 || info?.businessAddress || info?.personalAddress || 'In-house Print Pickup',
      addressLine2: linkedOrder?.shippingAddress.addressLine2 || '',
      city: linkedOrder?.shippingAddress.city || info?.city || 'Pune',
      state: linkedOrder?.shippingAddress.state || info?.state || 'Maharashtra',
      pinCode: linkedOrder?.shippingAddress.pinCode || info?.pinCode || '411001',
      country: linkedOrder?.shippingAddress.country || info?.country || 'India',
    });
    setPrintTarget({ design, owner, prof, linkedOrder });
  };

  const handleConfirmSendToPrint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!printTarget || !userRecord) return;
    const isLinkedOrderPaid =
      printTarget.linkedOrder?.paymentStatus === 'Verified' ||
      printTarget.linkedOrder?.paymentStatus === 'Completed';

    if (!isLinkedOrderPaid) {
      if (!printComplimentary) {
        notify(
          'Payment verification required',
          'Verify payment in Orders Ledger first, or explicitly mark this as a complimentary unpaid print run with a reason.',
          'error'
        );
        return;
      }
      if (printComplimentaryReason.trim().length < 3) {
        notify(
          'Complimentary reason required',
          'Provide a complimentary reason of at least 3 characters.',
          'error'
        );
        return;
      }
    }

    setSubmittingPrint(true);
    try {
      const res = await adminSendDesignToPrint({
        designId: printTarget.design.designId,
        ...(printTarget.linkedOrder?.orderId ? { orderId: printTarget.linkedOrder.orderId } : {}),
        printerId: printPrinterId || 'admin_inhouse',
        initialOrderStatus: printInitialStatus,
        cardType: printCardType,
        quantity: Math.max(1, Number(printQuantity) || 1),
        ...(!isLinkedOrderPaid
          ? {
              complimentary: true,
              complimentaryReason: printComplimentaryReason.trim(),
            }
          : {}),
        shippingAddress: printShipping,
        notes: printNotes,
      });

      if (printPrinterId && printPrinterId !== 'admin_inhouse') {
        const printerObj = printers.find((p) => p.printerId === printPrinterId);
        if (printerObj?.email) {
          await sendAndLogTransactionalEmail({
            uid: printTarget.design.uid,
            to: printerObj.email,
            templateId: 'printer_assigned',
            variables: { ORDER_NUMBER: res.orderNumber },
          });
        }
      }

      setPrintResult({
        ...res,
        design: printTarget.design,
        info: printTarget.prof?.personalInformation || {
          fullName: printShipping.fullName,
          mobile: printShipping.mobile,
          email: printShipping.email,
        },
      });
      notify(
        'Card sent to print!',
        `Order ${res.orderNumber} queued (${printInitialStatus}) via server with QR & 300 DPI PDF ready.`,
        'success'
      );
      load();
    } catch (err) {
      notify('Print routing failed', err instanceof Error ? err.message : 'Unable to send card to print.', 'error');
    } finally {
      setSubmittingPrint(false);
    }
  };

  const handleQuickDownloadExistingOrderPdf = async (
    d: CardDesignRecord,
    ord: OrderRecord,
    prof: ProfileRecord | undefined
  ) => {
    if (!userRecord) return;
    try {
      const qrDoc = await adminEnsureOrderQr(ord.orderId);
      if (!qrDoc.pngDataUrl) return;
      const pdf = await generatePrintReadyPdfBlob({
        design: d,
        info: prof?.personalInformation || {
          fullName: ord.shippingAddress.fullName,
          mobile: ord.shippingAddress.mobile,
          email: ord.shippingAddress.email,
        },
        qrPngDataUrl: qrDoc.pngDataUrl,
      });
      downloadBlob(pdf.blob, `${ord.orderNumber}-300dpi-print.pdf`);
      notify('300 DPI Print PDF generated', `${ord.orderNumber}`, 'success');
    } catch (err) {
      notify('PDF generation failed', err instanceof Error ? err.message : 'Unable to build PDF.', 'error');
    }
  };

  const handleQuickDownloadExistingOrderPng = async (
    d: CardDesignRecord,
    ord: OrderRecord,
    prof: ProfileRecord | undefined,
    side: 'front' | 'back'
  ) => {
    if (!userRecord) return;
    try {
      const qrDoc = await adminEnsureOrderQr(ord.orderId);
      if (!qrDoc.pngDataUrl) return;
      const png = await generateCardSidePngBlob({
        design: d,
        side,
        info: prof?.personalInformation || {
          fullName: ord.shippingAddress.fullName,
          mobile: ord.shippingAddress.mobile,
          email: ord.shippingAddress.email,
        },
        qrPngDataUrl: qrDoc.pngDataUrl,
      });
      downloadBlob(png.blob, `${ord.orderNumber}-${side}.png`);
      notify(
        `${side === 'front' ? 'Front' : 'Back'} PNG downloaded`,
        `${ord.orderNumber} (${png.widthPx} × ${png.heightPx} px)`,
        'success'
      );
    } catch (err) {
      notify('PNG export failed', err instanceof Error ? err.message : 'Unable to build PNG.', 'error');
    }
  };

  const handleDeleteDesign = async (d: CardDesignRecord, ownerLabel: string) => {
    if (!userRecord) return;
    const ok = await confirmAction({
      title: 'Delete Approved Design',
      message: `Permanently delete this approved card design for ${ownerLabel}? This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete Design',
    });
    if (!ok) return;
    try {
      await deleteCardDesign(
        d.designId,
        { uid: userRecord.uid, email: userRecord.email, role: userRecord.role },
        `Deleted approved design ${d.designId} (${ownerLabel})`
      );
      setDesigns((prev) => prev.filter((item) => item.designId !== d.designId));
      notify('Design deleted', `Removed approved design for ${ownerLabel}.`, 'success');
    } catch (err) {
      notify('Delete failed', err instanceof Error ? err.message : 'Unable to delete design.', 'error');
    }
  };

  return (
    <PortalLayout portal="admin" title="Approved Designs & Direct Print">
      <AdminCardsHubTabs />
      <div className="space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user name, email, or profile slug..."
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div className="text-xs font-mono text-slate-500">
            {filtered.length} approved card designs
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2].map((i) => (
              <div key={i} className="h-72 bg-slate-200 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
            No customer-approved card designs found yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {filtered.map((d) => {
              const owner = userMap.get(d.uid) || null;
              const prof = profileMap.get(d.profileId);
              const ownerLabel =
                owner?.displayName || prof?.personalInformation.fullName || owner?.email || d.uid;
              const linkedOrder =
                orders.find((o) => o.orderId === d.orderId || o.designId === d.designId) || null;
              const isPaid =
                linkedOrder?.paymentStatus === 'Verified' || linkedOrder?.paymentStatus === 'Completed';

              return (
                <div key={d.designId} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <div className="font-display font-bold text-base text-[#0B1D3A]">
                        {ownerLabel}
                      </div>
                      <div className="text-xs text-slate-500">
                        {owner?.email || d.uid} · {d.dimensions} ({d.cardOrientation})
                      </div>
                      {linkedOrder && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-600">
                          <span className="font-semibold text-[#0B1D3A]">{linkedOrder.orderNumber}</span>
                          <span>·</span>
                          <span className="text-[#1D4ED8] font-semibold">{linkedOrder.orderStatus}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                          isPaid
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {linkedOrder ? `Payment: ${linkedOrder.paymentStatus}` : 'Unpaid (Design Saved)'}
                      </span>

                      <button
                        type="button"
                        onClick={() => openSendToPrintModal(d, owner, prof || null, linkedOrder)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white rounded-lg text-xs font-semibold transition-colors"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>{linkedOrder ? 'Print / Reassign' : 'Send to Print'}</span>
                      </button>

                      {linkedOrder && (
                        <>
                          <Link
                            to={`/admin/orders/${linkedOrder.orderId}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold"
                          >
                            <span>Fulfil / Timeline</span>
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleQuickDownloadExistingOrderPdf(d, linkedOrder, prof)}
                            title="Download PDF"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Download PDF</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickDownloadExistingOrderPng(d, linkedOrder, prof, 'front')}
                            title="Download Front PNG"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold"
                          >
                            <ImageIcon className="h-3.5 w-3.5 text-[#1D4ED8]" />
                            <span>Front PNG</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickDownloadExistingOrderPng(d, linkedOrder, prof, 'back')}
                            title="Download Back PNG"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold"
                          >
                            <ImageIcon className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Back PNG</span>
                          </button>
                        </>
                      )}

                      {prof && (
                        <a
                          href={`/p/${prof.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#0B1D3A] text-white rounded-lg text-xs font-semibold hover:bg-[#132A52]"
                        >
                          <span>/p/{prof.slug}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteDesign(d, ownerLabel)}
                        title="Delete approved design"
                        aria-label={`Delete design for ${ownerLabel}`}
                        className="inline-flex items-center justify-center p-2 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="text-[11px] font-medium text-slate-500 mb-1.5">Front Side</div>
                      <CardCanvasPreview
                        side={d.frontDesign}
                        orientation={d.cardOrientation}
                        personalInfo={prof?.personalInformation || {}}
                      />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-slate-500 mb-1.5">Back Side</div>
                      <CardCanvasPreview
                        side={d.backDesign}
                        orientation={d.cardOrientation}
                        personalInfo={prof?.personalInformation || {}}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Direct Send-to-Print & Fulfilment Modal */}
      {printTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden my-auto">
            <div className="px-6 py-4 bg-[#0B1D3A] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <PrinterIcon className="h-5 w-5 text-cyan-300" />
                <div>
                  <div className="font-display font-bold text-base">
                    {printResult ? `Print Job Created: ${printResult.orderNumber}` : 'Send Approved Card Directly to Print'}
                  </div>
                  <div className="text-[11px] text-slate-300">
                    {printTarget.owner?.displayName || printTarget.prof?.personalInformation.fullName || printTarget.design.uid}
                    {printTarget.prof?.slug ? ` · /p/${printTarget.prof.slug}` : ''}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPrintTarget(null);
                  setPrintResult(null);
                }}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {printResult ? (
              <div className="p-6 space-y-5">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-emerald-950 space-y-1">
                    <div className="font-bold text-sm">
                      Order {printResult.orderNumber} is Ready for Production
                    </div>
                    <p>
                      High-resolution verified QR code has been attached and your 300 DPI print-ready PDF is available immediately.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50">
                  {printResult.qrRecord.pngDataUrl && (
                    <img
                      src={printResult.qrRecord.pngDataUrl}
                      alt="Order QR"
                      className="w-20 h-20 border border-slate-200 rounded-lg bg-white"
                    />
                  )}
                  <div className="space-y-1 text-xs min-w-0 flex-1">
                    <div className="font-semibold text-[#0B1D3A]">Verified SMART / QR Target</div>
                    <div className="font-mono text-slate-600 break-all">{printResult.qrRecord.targetUrl}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!printResult.qrRecord.pngDataUrl) return;
                      const pdf = await generatePrintReadyPdfBlob({
                        design: printResult.design,
                        info: printResult.info,
                        qrPngDataUrl: printResult.qrRecord.pngDataUrl,
                      });
                      downloadBlob(pdf.blob, `${printResult.orderNumber}-300dpi-print.pdf`);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#0B1D3A] hover:bg-[#132A52] text-white text-xs font-semibold rounded-xl"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!printResult.qrRecord.pngDataUrl) return;
                      const png = await generateCardSidePngBlob({
                        design: printResult.design,
                        side: 'front',
                        info: printResult.info,
                        qrPngDataUrl: printResult.qrRecord.pngDataUrl,
                      });
                      downloadBlob(png.blob, `${printResult.orderNumber}-front.png`);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl"
                  >
                    <ImageIcon className="h-4 w-4 text-[#1D4ED8]" />
                    <span>Front PNG</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!printResult.qrRecord.pngDataUrl) return;
                      const png = await generateCardSidePngBlob({
                        design: printResult.design,
                        side: 'back',
                        info: printResult.info,
                        qrPngDataUrl: printResult.qrRecord.pngDataUrl,
                      });
                      downloadBlob(png.blob, `${printResult.orderNumber}-back.png`);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl"
                  >
                    <ImageIcon className="h-4 w-4 text-emerald-600" />
                    <span>Back PNG</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!printResult.qrRecord.pngDataUrl) return;
                      const pdf = await generatePrintReadyPdfBlob({
                        design: printResult.design,
                        info: printResult.info,
                        qrPngDataUrl: printResult.qrRecord.pngDataUrl,
                        includeProofGuides: true,
                      });
                      downloadBlob(pdf.blob, `${printResult.orderNumber}-proof.pdf`);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl"
                  >
                    <FileText className="h-4 w-4" />
                    <span>Download Proof w/ Guides</span>
                  </button>
                  <Link
                    to={`/admin/orders/${printResult.orderId}`}
                    onClick={() => {
                      setPrintTarget(null);
                      setPrintResult(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold rounded-xl"
                  >
                    <span>Open Fulfilment Timeline</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConfirmSendToPrint} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Print Facility / Route *
                    </label>
                    <select
                      value={printPrinterId}
                      onChange={(e) => setPrintPrinterId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    >
                      <option value="admin_inhouse">In-House Print Press (Admin Direct)</option>
                      {printers.map((p) => (
                        <option key={p.printerId} value={p.printerId}>
                          {p.businessName} ({p.printerId})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Initial Fulfilment Stage *
                    </label>
                    <select
                      value={printInitialStatus}
                      onChange={(e) => setPrintInitialStatus(e.target.value as OrderStatus)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    >
                      <option value="Assigned to Printer">Assigned to Printer</option>
                      <option value="Printing in Progress">Printing in Progress</option>
                      <option value="Processing">Processing</option>
                      <option value="Quality Check">Quality Check</option>
                      <option value="Ready for Dispatch">Ready for Dispatch</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Card Finish / Type</label>
                    <input
                      type="text"
                      required
                      value={printCardType}
                      onChange={(e) => setPrintCardType(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Quantity *</label>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        required
                        value={printQuantity}
                        onChange={(e) => setPrintQuantity(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Server Unit Price</label>
                      <div className="w-full px-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-xs font-mono text-slate-700">
                        INR {printEstimatedUnitPrice}
                      </div>
                    </div>
                  </div>
                </div>

                {printTarget.linkedOrder?.paymentStatus === 'Verified' ||
                printTarget.linkedOrder?.paymentStatus === 'Completed' ? (
                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs text-emerald-900">
                    <strong className="block">Verified Paid Order ({printTarget.linkedOrder.paymentStatus})</strong>
                    <span>
                      Dispatches with its existing verified payment record and generates a{' '}
                      <span className="font-mono font-semibold">CUSTOMER_ORDER</span> print QR.
                    </span>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 space-y-2.5 text-xs">
                    <div className="text-amber-900">
                      <strong className="block">No Verified Payment on Order</strong>
                      <span>
                        To mark an order paid, verify payment in <strong>Orders Ledger</strong> first. Unpaid dispatch is restricted to explicit complimentary sample runs and keeps{' '}
                        <span className="font-mono font-semibold">paymentStatus = Pending</span> with an{' '}
                        <span className="font-mono font-semibold">ADMIN_CUSTOM</span> QR.
                      </span>
                    </div>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={printComplimentary}
                        onChange={(e) => setPrintComplimentary(e.target.checked)}
                        className="mt-0.5 rounded border-amber-400 text-[#1D4ED8]"
                      />
                      <span className="font-semibold text-[#0B1D3A]">
                        Send as Complimentary / Unpaid Print Run
                      </span>
                    </label>
                    {printComplimentary && (
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Complimentary Reason * (min 3 characters)
                        </label>
                        <input
                          type="text"
                          required
                          minLength={3}
                          value={printComplimentaryReason}
                          onChange={(e) => setPrintComplimentaryReason(e.target.value)}
                          placeholder="e.g. Executive VIP sample card approved by founder"
                          className="w-full px-3 py-2 border border-amber-300 bg-white rounded-lg text-xs"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 space-y-2.5">
                  <div className="text-xs font-semibold text-[#0B1D3A]">Recipient & Delivery Details</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      value={printShipping.fullName}
                      onChange={(e) => setPrintShipping({ ...printShipping, fullName: e.target.value })}
                      placeholder="Recipient Name *"
                      className="px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                    <input
                      type="tel"
                      required
                      value={printShipping.mobile}
                      onChange={(e) => setPrintShipping({ ...printShipping, mobile: e.target.value })}
                      placeholder="Mobile *"
                      className="px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                    />
                    <input
                      type="email"
                      required
                      value={printShipping.email}
                      onChange={(e) => setPrintShipping({ ...printShipping, email: e.target.value })}
                      placeholder="Email *"
                      className="px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                    <input
                      type="text"
                      required
                      value={printShipping.addressLine1}
                      onChange={(e) => setPrintShipping({ ...printShipping, addressLine1: e.target.value })}
                      placeholder="Delivery Address *"
                      className="sm:col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                    <input
                      type="text"
                      required
                      value={printShipping.city}
                      onChange={(e) => setPrintShipping({ ...printShipping, city: e.target.value })}
                      placeholder="City *"
                      className="px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                    <select
                      value={printShipping.state}
                      onChange={(e) => setPrintShipping({ ...printShipping, state: e.target.value })}
                      className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    >
                      {INDIAN_STATES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      required
                      value={printShipping.pinCode}
                      onChange={(e) => setPrintShipping({ ...printShipping, pinCode: e.target.value })}
                      placeholder="PIN Code *"
                      className="px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                    />
                    <input
                      type="text"
                      value={printNotes}
                      onChange={(e) => setPrintNotes(e.target.value)}
                      placeholder="Internal Print Notes"
                      className="px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setPrintTarget(null)}
                    className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      submittingPrint ||
                      (!(
                        printTarget.linkedOrder?.paymentStatus === 'Verified' ||
                        printTarget.linkedOrder?.paymentStatus === 'Completed'
                      ) &&
                        (!printComplimentary || printComplimentaryReason.trim().length < 3))
                    }
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-[#0B1D3A] hover:bg-[#132A52] text-white rounded-xl text-xs font-semibold disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>{submittingPrint ? 'Generating Print QR & Order...' : 'Confirm & Send to Print'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </PortalLayout>
  );
};
