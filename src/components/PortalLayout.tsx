import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  User,
  CreditCard,
  Package,
  Settings,
  Printer,
  Users,
  ShieldCheck,
  QrCode,
  FileText,
  Mail,
  LogOut,
  Menu,
  X,
  ExternalLink,
  BookOpen,
  ShoppingBag,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { TAPNEX_LOGO_URL } from './PublicLayout';

interface NavItem {
  label: string;
  to: string;
  icon: React.FC<{ className?: string }>;
  activePrefixes?: string[];
}

interface PortalLayoutProps {
  portal: 'customer' | 'printer' | 'admin' | 'superadmin';
  title: string;
  children: React.ReactNode;
}

export const PortalLayout: React.FC<PortalLayoutProps> = ({ portal, title, children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { userRecord, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const customerNav: NavItem[] = [
    { label: 'Overview', to: '/dashboard', icon: LayoutDashboard },
    {
      label: 'My Profile & Visibility',
      to: '/dashboard/profile',
      icon: User,
      activePrefixes: [
        '/dashboard/profile',
        '/dashboard/social-links',
        '/dashboard/custom-fields',
        '/dashboard/visibility',
      ],
    },
    {
      label: 'Design My Card',
      to: '/dashboard/card-design',
      icon: CreditCard,
      activePrefixes: ['/dashboard/card-design', '/dashboard/checkout'],
    },
    {
      label: 'Orders & Tracking',
      to: '/dashboard/orders',
      icon: Package,
      activePrefixes: ['/dashboard/orders', '/dashboard/tracking'],
    },
    {
      label: 'Account & Support',
      to: '/dashboard/settings',
      icon: Settings,
      activePrefixes: ['/dashboard/settings', '/dashboard/support'],
    },
    { label: 'User Guide (PDF)', to: '/guide', icon: BookOpen },
  ];

  const printerNav: NavItem[] = [
    { label: 'Printer Dashboard', to: '/printer/dashboard', icon: LayoutDashboard },
    {
      label: 'Assigned Orders',
      to: '/printer/orders',
      icon: Printer,
      activePrefixes: ['/printer/orders'],
    },
    { label: 'Facility Profile', to: '/printer/profile', icon: User },
    { label: 'User Guide (PDF)', to: '/guide', icon: BookOpen },
  ];

  const adminNav: NavItem[] = [
    { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard },
    {
      label: 'Users, Profiles & Printers',
      to: '/admin/users',
      icon: Users,
      activePrefixes: ['/admin/users', '/admin/profiles', '/admin/printers'],
    },
    {
      label: 'Cards & Approved Designs',
      to: '/admin/card-designs',
      icon: FileText,
      activePrefixes: ['/admin/card-designs', '/admin/approved-designs'],
    },
    { label: 'Shop & Smart Tags', to: '/admin/shop', icon: ShoppingBag },
    {
      label: 'Orders, Payments & Shipping',
      to: '/admin/orders',
      icon: Package,
      activePrefixes: ['/admin/orders', '/admin/payments', '/admin/shipping'],
    },
    {
      label: 'Gateways, QR & Reports',
      to: '/admin/settings',
      icon: Mail,
      activePrefixes: ['/admin/settings', '/admin/qr-management', '/admin/reports', '/admin/audit-logs'],
    },
    { label: 'User Guide (PDF)', to: '/guide', icon: BookOpen },
  ];

  const superAdminNav: NavItem[] = [
    { label: 'SuperAdmin Overview', to: '/superadmin/dashboard', icon: ShieldCheck },
    {
      label: 'Roles & Permissions',
      to: '/superadmin/roles',
      icon: Users,
      activePrefixes: ['/superadmin/roles', '/superadmin/permissions'],
    },
    {
      label: 'Profiles, Orders & Designs',
      to: '/admin/orders',
      icon: Package,
      activePrefixes: [
        '/admin/orders',
        '/admin/profiles',
        '/admin/approved-designs',
        '/admin/users',
        '/admin/printers',
        '/admin/payments',
        '/admin/shipping',
        '/admin/card-designs',
      ],
    },
    { label: 'Shop & Smart Tags', to: '/admin/shop', icon: ShoppingBag },
    { label: 'URL QR Generator', to: '/superadmin/qr-generator', icon: QrCode },
    {
      label: 'Gateways & System Settings',
      to: '/superadmin/system-settings',
      icon: Settings,
      activePrefixes: ['/superadmin/system-settings'],
    },
    { label: 'User Guide (PDF)', to: '/guide', icon: BookOpen },
  ];

  const navItems =
    portal === 'printer'
      ? printerNav
      : portal === 'admin'
        ? adminNav
        : portal === 'superadmin'
          ? superAdminNav
          : customerNav;

  const portalLabel =
    portal === 'printer'
      ? 'Printer Portal'
      : portal === 'admin'
        ? 'Admin Portal'
        : portal === 'superadmin'
          ? 'SuperAdmin Control'
          : 'Customer Portal';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isNavItemActive = (item: NavItem) => {
    if (item.activePrefixes && item.activePrefixes.length > 0) {
      return item.activePrefixes.some(
        (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`)
      );
    }
    return location.pathname === item.to;
  };

  const SidebarContent = (
    <div className="flex flex-col h-full bg-[#050814] text-slate-200">
      <div className="px-4 py-4 border-b border-slate-800 space-y-2.5">
        <Link
          to="/"
          className="flex items-center justify-center bg-white rounded-xl px-3 py-2 shadow-xs"
          aria-label="TapNex"
        >
          <img
            src={TAPNEX_LOGO_URL}
            alt="TapNex — Smart Connections. One Tap."
            className="h-12 w-auto max-w-full object-contain"
          />
        </Link>
        <div className="text-[11px] font-semibold text-cyan-400 tracking-wide text-center truncate">
          {portalLabel}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item, idx) => {
          const Icon = item.icon;
          const active = isNavItemActive(item);
          return (
            <Link
              key={`${item.to}-${idx}`}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[40px] ${
                active
                  ? 'bg-[#1D4ED8] text-white'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Role Cross-Links for Authorized Roles */}
      {(userRecord?.role === 'ADMIN' || userRecord?.role === 'SUPERADMIN') && (
        <div className="px-3 py-3 border-t border-slate-800 space-y-1">
          <div className="px-3 pb-1 text-xs font-medium text-slate-400">Switch Workspace</div>
          {portal !== 'customer' && (
            <Link
              to="/dashboard"
              onClick={() => setSidebarOpen(false)}
              className="block px-3 py-1.5 rounded text-xs text-slate-300 hover:bg-slate-800"
            >
              Customer Portal
            </Link>
          )}
          {portal !== 'admin' && (
            <Link
              to="/admin/dashboard"
              onClick={() => setSidebarOpen(false)}
              className="block px-3 py-1.5 rounded text-xs text-slate-300 hover:bg-slate-800"
            >
              Admin Portal
            </Link>
          )}
          {userRecord?.role === 'SUPERADMIN' && portal !== 'superadmin' && (
            <Link
              to="/superadmin/dashboard"
              onClick={() => setSidebarOpen(false)}
              className="block px-3 py-1.5 rounded text-xs text-cyan-300 hover:bg-slate-800"
            >
              SuperAdmin Control
            </Link>
          )}
        </div>
      )}

      <div className="p-4 border-t border-slate-800">
        <div className="mb-3">
          <p className="text-sm font-semibold text-white truncate">
            {userRecord?.displayName || userRecord?.email}
          </p>
          <p className="text-xs text-slate-400 truncate">
            {userRecord?.role} · {userRecord?.status}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors min-h-[38px]"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200">{SidebarContent}</aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[82vw] h-full shadow-xl">{SidebarContent}</div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="flex-1 bg-slate-950/50"
            aria-label="Close sidebar"
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="lg:hidden min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
              aria-label="Open menu"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="min-w-0">
              <div className="text-xs text-slate-500 truncate">{portalLabel}</div>
              <h1 className="font-display text-base sm:text-lg font-bold text-[#0B1D3A] truncate">{title}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg whitespace-nowrap min-h-[38px]"
            >
              <span>Public Site</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
};
