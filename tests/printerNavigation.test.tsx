import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettingsRecord, UserRecord, UserRole } from '../src/types';
import { DEFAULT_APP_SETTINGS } from '../src/lib/constants';

const testState = vi.hoisted(() => ({
  auth: {
    firebaseUser: null as { uid: string; email: string; emailVerified: boolean } | null,
    userRecord: null as UserRecord | null,
    appSettings: null as AppSettingsRecord | null,
    loading: false,
    isBlocked: false,
    needsEmailVerification: false,
    loginWithGoogle: vi.fn(),
    loginWithEmail: vi.fn(),
    registerWithEmail: vi.fn(),
    resendVerificationEmail: vi.fn(),
    requestPasswordReset: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    refreshSettings: vi.fn(),
  },
  initialEntry: '/',
  notify: vi.fn(),
}));

vi.mock('../src/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    ...testState.auth,
    appSettings: testState.auth.appSettings || DEFAULT_APP_SETTINGS,
  }),
}));

vi.mock('../src/contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ notify: testState.notify }),
}));

vi.mock('../src/lib/firestoreService', () => ({
  getCardTemplates: vi.fn().mockResolvedValue([]),
  getShopCategories: vi.fn().mockResolvedValue([]),
  getShopProducts: vi.fn().mockResolvedValue([]),
  getUserProfiles: vi.fn().mockResolvedValue([]),
  createPendingShopOrder: vi.fn(),
  sanitizeSlug: (s: string) => s,
  sendAndLogTransactionalEmail: vi.fn(),
}));

vi.mock('../src/lib/paymentApi', () => ({
  createPaymentOrder: vi.fn(),
  generatePurchasedQr: vi.fn(),
  verifyPayment: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => (
      <actual.MemoryRouter initialEntries={[testState.initialEntry]}>{children}</actual.MemoryRouter>
    ),
    Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
      <div data-navigate-to={to} data-navigate-replace={String(Boolean(replace))} />
    ),
  };
});

import App from '../src/App';
import { ProtectedRoute } from '../src/components/ProtectedRoute';
import { PublicLayout } from '../src/components/PublicLayout';
import { PortalLayout } from '../src/components/PortalLayout';
import { SmartCardLink } from '../src/components/SmartCardLink';
import { HomePage } from '../src/pages/public/HomePage';
import { CardDesignsPage, HowItWorksPage, PricingPage } from '../src/pages/public/InfoPages';
import { ShopPage } from '../src/pages/public/ShopPage';
import { RegisterPage } from '../src/pages/auth/AuthPages';
import {
  ADMIN_PORTAL_ALLOWED_ROLES,
  CUSTOMER_PORTAL_ALLOWED_ROLES,
  PRINTER_PORTAL_ALLOWED_ROLES,
  SUPERADMIN_PORTAL_ALLOWED_ROLES,
  getPublicHeaderPortalLink,
  getRoleDashboardPath,
  getSafePostAuthRedirect,
  getSmartCardNavigationTarget,
  isCustomerOnlyPath,
} from '../src/lib/roleNavigation';
import { MemoryRouter } from 'react-router-dom';

function makeUser(role: UserRole, overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    uid: `uid_${role.toLowerCase()}`,
    username: role.toLowerCase(),
    email: `${role.toLowerCase()}@tapnex.in`,
    displayName: `Test ${role}`,
    photoURL: '',
    role,
    status: 'Active',
    emailVerified: true,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function setAuthSession(role: UserRole | null, opts: { loading?: boolean } = {}) {
  testState.auth.loading = Boolean(opts.loading);
  testState.auth.isBlocked = false;
  testState.auth.needsEmailVerification = false;
  testState.auth.logout.mockReset();
  testState.notify.mockReset();

  if (!role) {
    testState.auth.firebaseUser = null;
    testState.auth.userRecord = null;
    return;
  }

  const record = makeUser(role);
  testState.auth.firebaseUser = {
    uid: record.uid,
    email: record.email,
    emailVerified: true,
  };
  testState.auth.userRecord = record;
}

describe('Printer role navigation and Customer Portal isolation', () => {
  beforeEach(() => {
    setAuthSession(null);
    testState.initialEntry = '/';
  });

  it('1. routes PRINTER sign-in to /printer/dashboard and rejects customer ?redirect overrides', () => {
    expect(getRoleDashboardPath('PRINTER')).toBe('/printer/dashboard');
    expect(getSafePostAuthRedirect(null, 'PRINTER')).toBe('/printer/dashboard');
    expect(getSafePostAuthRedirect('/dashboard', 'PRINTER')).toBe('/printer/dashboard');
    expect(getSafePostAuthRedirect('/dashboard/card-design', 'PRINTER')).toBe('/printer/dashboard');
    expect(getSafePostAuthRedirect('/dashboard/orders/ord_99', 'PRINTER')).toBe('/printer/dashboard');
    expect(getSafePostAuthRedirect('/printer/orders/ord_99', 'PRINTER')).toBe('/printer/orders/ord_99');
  });

  it('2. preserves PRINTER auth session when visiting Public Site and keeps Public Site link in PortalLayout', () => {
    setAuthSession('PRINTER');

    const publicHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <PublicLayout>
          <div>Public Content</div>
        </PublicLayout>
      </MemoryRouter>
    );
    expect(publicHtml).toContain('Public Content');
    expect(testState.auth.logout).not.toHaveBeenCalled();
    expect(testState.auth.userRecord?.role).toBe('PRINTER');

    const printerPortalHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/printer/dashboard']}>
        <PortalLayout portal="printer" title="Printer Dashboard">
          <div>Printer Jobs</div>
        </PortalLayout>
      </MemoryRouter>
    );
    expect(printerPortalHtml).toContain('href="/"');
    expect(printerPortalHtml).toContain('Public Site');
  });

  it('3. routes PRINTER clicking Get Your Smart Card and all studio/order CTAs to /printer/dashboard', () => {
    setAuthSession('PRINTER');

    const layoutHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <PublicLayout>
          <SmartCardLink>Get Your Smart Card</SmartCardLink>
        </PublicLayout>
      </MemoryRouter>
    );
    expect(layoutHtml).toContain('href="/printer/dashboard"');
    expect(layoutHtml).not.toContain('href="/dashboard/card-design"');
    expect(layoutHtml).not.toContain('href="/register"');

    const homeHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <HomePage />
      </MemoryRouter>
    );
    expect(homeHtml).toContain('Get Your Smart Card');
    expect(homeHtml).toContain('href="/printer/dashboard"');
    expect(homeHtml).not.toContain('href="/dashboard/card-design"');
    expect(homeHtml).not.toContain('href="/register"');

    const infoHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/how-it-works']}>
        <>
          <HowItWorksPage />
          <CardDesignsPage />
          <PricingPage />
        </>
      </MemoryRouter>
    );
    expect(infoHtml).not.toContain('href="/dashboard/card-design"');
    expect(infoHtml).not.toContain('href="/register"');
    expect(infoHtml).toContain('href="/printer/dashboard"');

    const shopHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/shop']}>
        <ShopPage />
      </MemoryRouter>
    );
    expect(shopHtml).not.toContain('href="/dashboard/card-design"');
    expect(shopHtml).not.toContain('href="/dashboard"');
    expect(shopHtml).toContain('Open Printer Portal');
  });

  it('4. shows Printer Portal navigation link on public pages ONLY to authenticated PRINTER users', () => {
    setAuthSession('PRINTER');
    const printerHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/features']}>
        <PublicLayout>
          <div>Features</div>
        </PublicLayout>
      </MemoryRouter>
    );
    expect(printerHtml).toContain('>Printer Portal<');
    expect(printerHtml).toContain('href="/printer/dashboard"');

    for (const role of ['USER', 'ADMIN', 'SUPERADMIN', null] as const) {
      setAuthSession(role);
      const html = renderToStaticMarkup(
        <MemoryRouter initialEntries={['/features']}>
          <PublicLayout>
            <div>Features</div>
          </PublicLayout>
        </MemoryRouter>
      );
      expect(html).not.toContain('>Printer Portal<');
      if (role) {
        expect(html).toContain('>Portal<');
      } else {
        expect(html).toContain('>Login<');
      }
    }
  });

  it('5. blocks PRINTER from all Customer Portal routes (/dashboard*) and /register without redirect loops', () => {
    expect(CUSTOMER_PORTAL_ALLOWED_ROLES).not.toContain('PRINTER');
    expect(PRINTER_PORTAL_ALLOWED_ROLES).toContain('PRINTER');

    setAuthSession('PRINTER');

    const customerUrls = [
      '/dashboard',
      '/dashboard/profile',
      '/dashboard/social-links',
      '/dashboard/custom-fields',
      '/dashboard/visibility',
      '/dashboard/card-design',
      '/dashboard/checkout',
      '/dashboard/orders',
      '/dashboard/tracking',
      '/dashboard/orders/ord_123',
      '/dashboard/settings',
      '/dashboard/support',
    ];

    for (const path of customerUrls) {
      expect(isCustomerOnlyPath(path)).toBe(true);
      testState.initialEntry = path;
      const appHtml = renderToStaticMarkup(<App />);
      expect(appHtml).toContain('data-navigate-to="/printer/dashboard"');
      expect(appHtml).not.toContain('Customer Portal');

      // Defense-in-depth even if a caller misconfigures allowedRoles
      const directGuardHtml = renderToStaticMarkup(
        <MemoryRouter initialEntries={[path]}>
          <ProtectedRoute allowedRoles={['USER', 'PRINTER']}>
            <div>Forbidden Customer UI</div>
          </ProtectedRoute>
        </MemoryRouter>
      );
      expect(directGuardHtml).toContain('data-navigate-to="/printer/dashboard"');
      expect(directGuardHtml).not.toContain('Forbidden Customer UI');
    }

    // Authenticated PRINTER visiting /register redirects to /printer/dashboard
    const registerHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>
    );
    expect(registerHtml).toContain('data-navigate-to="/printer/dashboard"');
    expect(registerHtml).not.toContain('Create Customer Account');

    // Authorized PRINTER route renders without redirect loop
    const printerRouteHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/printer/dashboard']}>
        <ProtectedRoute allowedRoles={PRINTER_PORTAL_ALLOWED_ROLES}>
          <div>Printer Dashboard Active</div>
        </ProtectedRoute>
      </MemoryRouter>
    );
    expect(printerRouteHtml).toContain('Printer Dashboard Active');
    expect(printerRouteHtml).not.toContain('data-navigate-to');
  });

  it('6. keeps normal customer (USER) navigation and Customer Portal access intact', () => {
    setAuthSession('USER');

    const layoutHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <PublicLayout>
          <div>Home</div>
        </PublicLayout>
      </MemoryRouter>
    );
    expect(layoutHtml).toContain('href="/dashboard/card-design"');
    expect(layoutHtml).toContain('href="/dashboard"');
    expect(layoutHtml).toContain('>Portal<');
    expect(layoutHtml).not.toContain('>Printer Portal<');

    const guardHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/dashboard/card-design']}>
        <ProtectedRoute allowedRoles={CUSTOMER_PORTAL_ALLOWED_ROLES}>
          <div>Card Studio Allowed</div>
        </ProtectedRoute>
      </MemoryRouter>
    );
    expect(guardHtml).toContain('Card Studio Allowed');
    expect(guardHtml).not.toContain('data-navigate-to');
  });

  it('7. keeps unauthenticated visitor navigation to /register, /login, and protects portals', () => {
    setAuthSession(null);

    const layoutHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <PublicLayout>
          <div>Home</div>
        </PublicLayout>
      </MemoryRouter>
    );
    expect(layoutHtml).toContain('href="/register"');
    expect(layoutHtml).toContain('href="/login"');
    expect(layoutHtml).toContain('>Login<');
    expect(layoutHtml).not.toContain('>Printer Portal<');

    const guardHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ProtectedRoute allowedRoles={CUSTOMER_PORTAL_ALLOWED_ROLES}>
          <div>Secret</div>
        </ProtectedRoute>
      </MemoryRouter>
    );
    expect(guardHtml).toContain('data-navigate-to="/login"');
    expect(guardHtml).not.toContain('Secret');
  });

  it('8. preserves ADMIN and SUPERADMIN portal routing and access', () => {
    expect(ADMIN_PORTAL_ALLOWED_ROLES).toEqual(['ADMIN', 'SUPERADMIN']);
    expect(SUPERADMIN_PORTAL_ALLOWED_ROLES).toEqual(['SUPERADMIN']);

    for (const [role, expectedPath] of [
      ['ADMIN', '/admin/dashboard'],
      ['SUPERADMIN', '/superadmin/dashboard'],
    ] as const) {
      setAuthSession(role);
      const html = renderToStaticMarkup(
        <MemoryRouter initialEntries={['/']}>
          <PublicLayout>
            <div>Home</div>
          </PublicLayout>
        </MemoryRouter>
      );
      expect(html).toContain(`href="${expectedPath}"`);
      expect(html).toContain('>Portal<');
      expect(html).not.toContain('>Printer Portal<');

      const customerAccess = renderToStaticMarkup(
        <MemoryRouter initialEntries={['/dashboard']}>
          <ProtectedRoute allowedRoles={CUSTOMER_PORTAL_ALLOWED_ROLES}>
            <div>Customer OK</div>
          </ProtectedRoute>
        </MemoryRouter>
      );
      expect(customerAccess).toContain('Customer OK');
    }
  });

  it('9. waits for auth hydration on refresh without misrouting PRINTER as guest or customer', () => {
    setAuthSession(null, { loading: true });

    const hydratingGuardHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/dashboard/card-design']}>
        <ProtectedRoute allowedRoles={CUSTOMER_PORTAL_ALLOWED_ROLES}>
          <div>Customer Studio</div>
        </ProtectedRoute>
      </MemoryRouter>
    );
    expect(hydratingGuardHtml).toContain('animate-pulse');
    expect(hydratingGuardHtml).not.toContain('data-navigate-to="/login"');
    expect(hydratingGuardHtml).not.toContain('Customer Studio');

    const hydratingLinkHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/pricing']}>
        <PublicLayout>
          <SmartCardLink>Get Your Smart Card</SmartCardLink>
        </PublicLayout>
      </MemoryRouter>
    );
    expect(hydratingLinkHtml).toContain('aria-disabled="true"');
    expect(hydratingLinkHtml).not.toContain('href="/register"');

    // Once hydration resolves with PRINTER role, public links immediately reflect PRINTER targets
    setAuthSession('PRINTER', { loading: false });
    const hydratedHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/pricing']}>
        <PublicLayout>
          <SmartCardLink>Get Your Smart Card</SmartCardLink>
        </PublicLayout>
      </MemoryRouter>
    );
    expect(hydratedHtml).toContain('>Printer Portal<');
    expect(hydratedHtml).toContain('href="/printer/dashboard"');
  });

  it('10. resets public header and SmartCardLink targets after explicit logout', () => {
    setAuthSession('PRINTER');
    expect(
      getPublicHeaderPortalLink({ isAuthenticated: true, loading: false, role: 'PRINTER' })
    ).toEqual({
      label: 'Printer Portal',
      to: '/printer/dashboard',
      isPrinterPortal: true,
    });
    expect(
      getSmartCardNavigationTarget({ isAuthenticated: true, loading: false, role: 'PRINTER' })
    ).toBe('/printer/dashboard');

    setAuthSession(null);
    expect(
      getPublicHeaderPortalLink({ isAuthenticated: false, loading: false, role: null })
    ).toEqual({
      label: 'Login',
      to: '/login',
      isPrinterPortal: false,
    });
    expect(
      getSmartCardNavigationTarget({ isAuthenticated: false, loading: false, role: null })
    ).toBe('/register');

    const loggedOutHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <PublicLayout>
          <div>Logged Out</div>
        </PublicLayout>
      </MemoryRouter>
    );
    expect(loggedOutHtml).toContain('href="/register"');
    expect(loggedOutHtml).toContain('>Login<');
    expect(loggedOutHtml).not.toContain('>Printer Portal<');
  });
});
