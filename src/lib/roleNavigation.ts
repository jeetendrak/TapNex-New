import type { UserRole } from '../types';

export const CUSTOMER_PORTAL_ALLOWED_ROLES: UserRole[] = ['USER', 'ADMIN', 'SUPERADMIN'];
export const PRINTER_PORTAL_ALLOWED_ROLES: UserRole[] = ['PRINTER', 'ADMIN', 'SUPERADMIN'];
export const ADMIN_PORTAL_ALLOWED_ROLES: UserRole[] = ['ADMIN', 'SUPERADMIN'];
export const SUPERADMIN_PORTAL_ALLOWED_ROLES: UserRole[] = ['SUPERADMIN'];

export function getRoleDashboardPath(role?: UserRole | null): string {
  if (role === 'SUPERADMIN') return '/superadmin/dashboard';
  if (role === 'ADMIN') return '/admin/dashboard';
  if (role === 'PRINTER') return '/printer/dashboard';
  return '/dashboard';
}

export function isCustomerOnlyPath(pathname: string): boolean {
  const clean = pathname.split('?')[0].split('#')[0];
  return clean === '/dashboard' || clean.startsWith('/dashboard/');
}

export function getSmartCardNavigationTarget(params: {
  isAuthenticated: boolean;
  loading?: boolean;
  role?: UserRole | null;
}): string {
  if (params.loading) {
    return '#';
  }
  if (!params.isAuthenticated || !params.role) {
    return '/register';
  }
  if (params.role === 'PRINTER') {
    return '/printer/dashboard';
  }
  if (params.role === 'ADMIN') {
    return '/admin/dashboard';
  }
  if (params.role === 'SUPERADMIN') {
    return '/superadmin/dashboard';
  }
  return '/dashboard/card-design';
}

export function getPublicHeaderPortalLink(params: {
  isAuthenticated: boolean;
  loading?: boolean;
  role?: UserRole | null;
}): { label: string; to: string; isPrinterPortal: boolean } {
  if (params.loading || !params.isAuthenticated || !params.role) {
    return { label: 'Login', to: '/login', isPrinterPortal: false };
  }
  if (params.role === 'PRINTER') {
    return { label: 'Printer Portal', to: '/printer/dashboard', isPrinterPortal: true };
  }
  return {
    label: 'Portal',
    to: getRoleDashboardPath(params.role),
    isPrinterPortal: false,
  };
}

export function getSafePostAuthRedirect(
  rawRedirect: string | null | undefined,
  role: UserRole
): string {
  const clean = typeof rawRedirect === 'string' ? rawRedirect.trim() : '';
  if (clean.startsWith('/') && !clean.startsWith('//')) {
    if (role === 'PRINTER' && isCustomerOnlyPath(clean)) {
      return '/printer/dashboard';
    }
    return clean;
  }
  return getRoleDashboardPath(role);
}
