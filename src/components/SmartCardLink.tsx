import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getSmartCardNavigationTarget } from '../lib/roleNavigation';

interface SmartCardLinkProps {
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}

export const SmartCardLink: React.FC<SmartCardLinkProps> = ({
  className,
  onClick,
  children,
}) => {
  const { firebaseUser, userRecord, loading } = useAuth();
  const location = useLocation();

  const isAuthenticated = Boolean(firebaseUser && userRecord);
  const target = getSmartCardNavigationTarget({
    isAuthenticated,
    loading,
    role: userRecord?.role,
  });

  const resolvedTo = loading ? `${location.pathname}${location.search}` : target;

  return (
    <Link
      to={resolvedTo}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.();
      }}
      aria-disabled={loading || undefined}
      className={className}
    >
      {children}
    </Link>
  );
};
