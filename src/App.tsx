import React from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PublicLayout } from './components/PublicLayout';

// Public Pages
import { HomePage } from './pages/public/HomePage';
import {
  CardDesignsPage,
  ContactPage,
  FaqPage,
  FeaturesPage,
  HowItWorksPage,
  LegalDocPage,
  NfcGuidePage,
  PricingPage,
} from './pages/public/InfoPages';
import { PublicProfilePage } from './pages/public/PublicProfilePage';
import { ShopPage } from './pages/public/ShopPage';
import { UserGuidePage } from './pages/public/UserGuidePage';

// Auth Pages
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  VerifyEmailPage,
} from './pages/auth/AuthPages';

// Customer Portal Pages
import {
  CustomerCustomFieldsPage,
  CustomerOverviewPage,
  CustomerProfilePage,
  CustomerSocialLinksPage,
  CustomerVisibilityPage,
} from './pages/customer/CustomerProfilePages';
import {
  CustomerCardStudioPage,
  CustomerCheckoutPage,
  CustomerOrdersPage,
  CustomerSettingsPage,
  CustomerSupportPage,
} from './pages/customer/CustomerStudioCheckoutPages';

// Printer Portal Pages
import {
  PrinterDashboardPage,
  PrinterOrderDetailPage,
  PrinterOrdersPage,
  PrinterProfilePage,
} from './pages/printer/PrinterPortalPages';

// Admin Portal Pages
import {
  AdminApprovedDesignsPage,
  AdminAuditLogsPage,
  AdminCardTemplatesPage,
  AdminDashboardPage,
  AdminOrderDetailPage,
  AdminOrdersPage,
  AdminPaymentsPage,
  AdminPrintersPage,
  AdminProfilesPage,
  AdminQrManagementPage,
  AdminReportsPage,
  AdminSettingsAndTicketsPage,
  AdminShippingPage,
  AdminUserDetailPage,
  AdminUsersPage,
} from './pages/admin/AdminPortalPages';
import { AdminShopPage } from './pages/admin/AdminShopPage';

// SuperAdmin Portal Pages
import {
  SuperAdminDashboardPage,
  SuperAdminPermissionsPage,
  SuperAdminQrGeneratorPage,
  SuperAdminRolesPage,
  SuperAdminSystemSettingsPage,
} from './pages/superadmin/SuperAdminPages';

const NotFoundPage: React.FC = () => (
  <PublicLayout>
    <section className="max-w-xl mx-auto px-4 py-24 text-center">
      <div className="font-mono text-sm font-bold text-[#1D4ED8]">404</div>
      <h1 className="mt-2 font-display text-3xl font-bold text-[#0B1D3A]">Page Not Found</h1>
      <p className="mt-3 text-sm text-slate-600">
        The page or smart profile route you requested does not exist or has moved.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link to="/" className="px-5 py-2.5 bg-[#0B1D3A] text-white text-sm font-semibold rounded-xl">
          Return Home
        </Link>
        <Link to="/login" className="px-5 py-2.5 border border-slate-300 text-slate-800 text-sm font-semibold rounded-xl">
          Sign In
        </Link>
      </div>
    </section>
  </PublicLayout>
);

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* Public Marketing & Legal Routes */}
            <Route path="/" element={<HomePage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/shop" element={<ShopPage />} />
            <Route path="/card-designs" element={<CardDesignsPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="/guide" element={<UserGuidePage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/nfc-guide" element={<NfcGuidePage />} />
            <Route path="/privacy" element={<LegalDocPage type="privacy" />} />
            <Route path="/terms" element={<LegalDocPage type="terms" />} />
            <Route path="/refund-policy" element={<LegalDocPage type="refund" />} />

            {/* Public Digital Business Profile (No Login Required) */}
            <Route path="/p/:slug" element={<PublicProfilePage />} />
            <Route path="/p/:slug/*" element={<PublicProfilePage />} />

            {/* Authentication Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />

            {/* Customer Portal */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerOverviewPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/profile"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/social-links"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerSocialLinksPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/custom-fields"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerCustomFieldsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/visibility"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerVisibilityPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/card-design"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerCardStudioPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/checkout"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerCheckoutPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/orders"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerOrdersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/tracking"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerOrdersPage initialTab="tracking" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/orders/:orderId"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerOrdersPage initialTab="tracking" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/settings"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerSettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/support"
              element={
                <ProtectedRoute allowedRoles={['USER', 'PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <CustomerSupportPage />
                </ProtectedRoute>
              }
            />

            {/* Printer Portal */}
            <Route path="/printer" element={<Navigate to="/printer/dashboard" replace />} />
            <Route
              path="/printer/dashboard"
              element={
                <ProtectedRoute allowedRoles={['PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <PrinterDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/printer/orders"
              element={
                <ProtectedRoute allowedRoles={['PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <PrinterOrdersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/printer/orders/:orderId"
              element={
                <ProtectedRoute allowedRoles={['PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <PrinterOrderDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/printer/profile"
              element={
                <ProtectedRoute allowedRoles={['PRINTER', 'ADMIN', 'SUPERADMIN']}>
                  <PrinterProfilePage />
                </ProtectedRoute>
              }
            />

            {/* Admin Portal */}
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route
              path="/admin/dashboard"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminUsersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users/:uid"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminUserDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/printers"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminPrintersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/profiles"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminProfilesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/approved-designs"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminApprovedDesignsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/orders"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminOrdersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/orders/:orderId"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminOrderDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/payments"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminPaymentsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/card-designs"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminCardTemplatesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/shop"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminShopPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/qr-management"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminQrManagementPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/shipping"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminShippingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/reports"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/settings"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminSettingsAndTicketsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/audit-logs"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'SUPERADMIN']}>
                  <AdminAuditLogsPage />
                </ProtectedRoute>
              }
            />

            {/* SuperAdmin Portal */}
            <Route path="/superadmin" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route
              path="/superadmin/dashboard"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN']}>
                  <SuperAdminDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/roles"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN']}>
                  <SuperAdminRolesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/permissions"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN']}>
                  <SuperAdminPermissionsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/qr-generator"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN']}>
                  <SuperAdminQrGeneratorPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/system-settings"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN']}>
                  <SuperAdminSystemSettingsPage />
                </ProtectedRoute>
              }
            />

            {/* 404 Fallback */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
