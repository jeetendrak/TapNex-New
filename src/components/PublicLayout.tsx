import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const TAPNEX_LOGO_URL = '/assets/aistudio/TapNex_Smart_Connections_Logo_79022558.png';
export const TAPNEX_PUBLIC_BADGE_LOGO_URL = '/assets/aistudio/TapNex_Neon_Contactless_Icon__1__7967dbb5.webp';

export const PublicLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { userRecord } = useAuth();
  const location = useLocation();

  const portalPath =
    userRecord?.role === 'SUPERADMIN'
      ? '/superadmin/dashboard'
      : userRecord?.role === 'ADMIN'
        ? '/admin/dashboard'
        : userRecord?.role === 'PRINTER'
          ? '/printer/dashboard'
          : '/dashboard';

  const navLinks = [
    { label: 'Shop', to: '/shop' },
    { label: 'How It Works', to: '/how-it-works' },
    { label: 'Card Designs', to: '/card-designs' },
    { label: 'Pricing', to: '/pricing' },
    { label: userRecord ? 'Portal' : 'Login', to: userRecord ? portalPath : '/login' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 overflow-x-hidden">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Brand Logo */}
          <Link
            to="/"
            className="inline-flex items-center shrink-0 py-1"
            aria-label="TapNex Home"
          >
            <img
              src={TAPNEX_LOGO_URL}
              alt="TapNex — Smart Connections. One Tap."
              className="h-12 sm:h-14 w-auto object-contain"
            />
          </Link>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            {navLinks.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#0B1D3A] ${
                    active ? 'text-[#1D4ED8] font-semibold' : ''
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary CTA */}
          <div className="flex items-center gap-3 shrink-0">
            <Link
              to={userRecord ? '/dashboard/card-design' : '/register'}
              className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-white bg-[#0B1D3A] hover:bg-[#132A52] rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              Get Your Smart Card
            </Link>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-slate-700 hover:bg-slate-100"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-2">
            {navLinks.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 min-h-[44px]"
              >
                {item.label}
              </Link>
            ))}
            <Link
              to="/features"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 min-h-[44px]"
            >
              Features
            </Link>
            <Link
              to="/faq"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 min-h-[44px]"
            >
              FAQ
            </Link>
            <Link
              to="/guide"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 min-h-[44px]"
            >
              User Guide (PDF)
            </Link>
            <Link
              to="/contact"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 min-h-[44px]"
            >
              Contact
            </Link>
            <Link
              to={userRecord ? '/dashboard/card-design' : '/register'}
              onClick={() => setMobileMenuOpen(false)}
              className="block text-center mt-2 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-[#0B1D3A]"
            >
              Get Your Smart Card
            </Link>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      {/* Quiet Structured Footer */}
      <footer className="bg-[#050814] text-slate-300 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="md:col-span-1">
            <Link to="/" className="inline-flex items-center bg-white px-4 py-2.5 rounded-xl shadow-xs">
              <img
                src={TAPNEX_LOGO_URL}
                alt="TapNex — Smart Connections. One Tap."
                className="h-14 w-auto object-contain"
              />
            </Link>
            <p className="mt-3 text-sm text-slate-400 leading-relaxed">
              Premium smart business cards paired with seamless digital identity integration, enabling instant contact sharing and real-time digital networking across India.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Platform</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><Link to="/shop" className="hover:text-white transition-colors">Shop Smart Tags</Link></li>
              <li><Link to="/how-it-works" className="hover:text-white transition-colors">How It Works</Link></li>
              <li><Link to="/features" className="hover:text-white transition-colors">Features</Link></li>
              <li><Link to="/card-designs" className="hover:text-white transition-colors">Card Designs</Link></li>
              <li><Link to="/pricing" className="hover:text-white transition-colors">Pricing</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Resources</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><Link to="/guide" className="hover:text-white transition-colors">Complete User Guide (PDF)</Link></li>
              <li><Link to="/faq" className="hover:text-white transition-colors">FAQ</Link></li>
              <li><Link to="/nfc-guide" className="hover:text-white transition-colors">Smartcard Compatibility Guide</Link></li>
              <li><Link to="/contact" className="hover:text-white transition-colors">Contact Support</Link></li>
              <li><Link to="/login" className="hover:text-white transition-colors">Portal Login</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Legal & Policies</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
              <li><Link to="/refund-policy" className="hover:text-white transition-colors">Refund & Cancellation Policy</Link></li>
              <li className="pt-2 text-xs text-slate-400">support@tapnex.in · India Fulfilment (10–15 Days)</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-800/80 py-5 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} TapNex Smart Identity Systems. All rights reserved.</span>
          <span>Tap &amp; QR Hybrid SMART Business Cards</span>
        </div>
      </footer>
    </div>
  );
};
