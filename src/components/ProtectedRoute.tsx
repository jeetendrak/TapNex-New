import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles, children }) => {
  const { firebaseUser, userRecord, loading, isBlocked, needsEmailVerification, logout } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-full max-w-md p-6 space-y-4">
          <div className="h-6 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="h-32 w-full bg-slate-200 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (!firebaseUser || !userRecord) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (isBlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-2xl p-6 text-center">
          <h2 className="font-display text-xl font-bold text-slate-900">Account Suspended</h2>
          <p className="mt-2 text-sm text-slate-600">
            Your account status is currently <strong>{userRecord.status}</strong>. Access to protected portals is restricted. Please contact support@tapnex.in.
          </p>
          <button
            type="button"
            onClick={() => logout()}
            className="mt-5 px-4 py-2 bg-[#0B1D3A] text-white text-sm font-semibold rounded-lg"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (needsEmailVerification) {
    return <Navigate to="/verify-email" replace />;
  }

  if (!allowedRoles.includes(userRecord.role)) {
    const fallback =
      userRecord.role === 'SUPERADMIN'
        ? '/superadmin/dashboard'
        : userRecord.role === 'ADMIN'
          ? '/admin/dashboard'
          : userRecord.role === 'PRINTER'
            ? '/printer/dashboard'
            : '/dashboard';
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
};
