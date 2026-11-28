import React, { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { MailCheck, Lock, UserPlus, LogIn, RefreshCw, ShieldAlert, User, Eye, EyeOff } from 'lucide-react';
import { PublicLayout, TAPNEX_LOGO_URL } from '../../components/PublicLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getRoleDashboardPath, getSafePostAuthRedirect } from '../../lib/roleNavigation';

const GoogleLogoIcon: React.FC<{ className?: string }> = ({ className = 'h-5 w-5 shrink-0' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

function getSafeRedirectTarget(searchParams: URLSearchParams, role: Parameters<typeof getSafePostAuthRedirect>[1]): string {
  return getSafePostAuthRedirect(searchParams.get('redirect'), role);
}

function mapAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('auth/operation-not-allowed')) {
    return 'Email/Password sign-in is not yet enabled in Firebase Console → Authentication → Sign-in method. Please use Google Sign-In or enable Email/Password in Firebase Console.';
  }
  if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password')) {
    return 'Invalid email or password.';
  }
  if (msg.includes('auth/email-already-in-use')) {
    return 'An account with this email already exists.';
  }
  if (msg.includes('auth/weak-password')) {
    return 'Password must be at least 6 characters.';
  }
  if (msg.includes('auth/popup-closed-by-user')) {
    return 'Google sign-in popup was closed before completing.';
  }
  return msg;
}

export const LoginPage: React.FC = () => {
  const { loginWithGoogle, loginWithEmail } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleGoogle = async () => {
    setErrorMsg('');
    setSubmitting(true);
    try {
      const user = await loginWithGoogle();
      notify('Signed in', `Welcome back, ${user.displayName || user.email}`, 'success');
      navigate(getSafeRedirectTarget(searchParams, user.role));
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const user = await loginWithEmail(email.trim(), password);
      if (!user.emailVerified) {
        navigate('/verify-email');
        return;
      }
      notify('Signed in', `Welcome back, ${user.displayName || user.email}`, 'success');
      navigate(getSafeRedirectTarget(searchParams, user.role));
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <div className="relative overflow-hidden min-h-[calc(100vh-12rem)] flex items-center justify-center px-4 py-16 sm:py-20 bg-[radial-gradient(circle_at_50%_20%,#F6FAFF_0%,#E8F2FE_52%,#D8E8FC_100%)]">
        {/* Soft ambient sky glow behind card */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-[440px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(56,162,255,0.22)_0%,rgba(147,197,253,0.08)_55%,transparent_75%)] blur-2xl" />
        </div>

        <div className="relative w-full max-w-md">
          {/* Decorative liquid-glass water splashes & translucent droplets framing the card */}
          <div aria-hidden="true" className="pointer-events-none hidden sm:block">
            {/* Left liquid splash */}
            <svg
              viewBox="0 0 180 260"
              className="absolute -left-24 top-16 h-60 w-44 drop-shadow-[0_14px_24px_rgba(14,104,224,0.25)]"
            >
              <defs>
                <linearGradient id="tapnexSplashLeft" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#9ED8FF" stopOpacity="0.88" />
                  <stop offset="48%" stopColor="#268BFF" stopOpacity="0.72" />
                  <stop offset="100%" stopColor="#085AD4" stopOpacity="0.82" />
                </linearGradient>
              </defs>
              <path
                d="M172,56 C128,44 92,16 56,28 C20,40 16,86 50,104 C82,120 112,130 120,168 C128,204 152,232 174,238 Z"
                fill="url(#tapnexSplashLeft)"
                stroke="rgba(255,255,255,0.8)"
                strokeWidth="2.5"
              />
              <path
                d="M58,38 C36,46 34,74 58,86"
                fill="none"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>

            {/* Right liquid splash */}
            <svg
              viewBox="0 0 180 240"
              className="absolute -right-24 top-28 h-56 w-44 drop-shadow-[0_14px_24px_rgba(14,104,224,0.25)]"
            >
              <defs>
                <linearGradient id="tapnexSplashRight" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#9ED8FF" stopOpacity="0.86" />
                  <stop offset="50%" stopColor="#1D82FF" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#085AD4" stopOpacity="0.8" />
                </linearGradient>
              </defs>
              <path
                d="M8,46 C58,58 120,44 148,78 C176,112 152,158 104,174 C58,190 28,210 6,222 Z"
                fill="url(#tapnexSplashRight)"
                stroke="rgba(255,255,255,0.8)"
                strokeWidth="2.5"
              />
              <path
                d="M138,88 C154,110 140,142 108,156"
                fill="none"
                stroke="rgba(255,255,255,0.82)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>

            {/* Floating glass droplets */}
            <span className="absolute -left-24 -top-2 h-8 w-8 rounded-full bg-[radial-gradient(circle_at_30%_30%,#ffffff_0%,#bae6fd_45%,#2589ff_85%,#e0f2fe_100%)] border border-white/85 shadow-[0_10px_18px_-4px_rgba(11,116,245,0.35),inset_0_2px_4px_rgba(255,255,255,0.95)]" />
            <span className="absolute -left-10 top-6 h-4 w-4 rounded-full bg-[radial-gradient(circle_at_30%_30%,#ffffff_0%,#bae6fd_55%,#38a2ff_92%)] border border-white/85 shadow-[0_6px_12px_-2px_rgba(11,116,245,0.3)]" />
            <span className="absolute -left-28 top-52 h-11 w-11 rounded-full bg-[radial-gradient(circle_at_32%_28%,#ffffff_0%,#cbe9ff_46%,#1f7ef5_86%,#e0f2fe_100%)] border border-white/90 shadow-[0_12px_22px_-4px_rgba(11,116,245,0.38),inset_0_2px_5px_rgba(255,255,255,0.95)]" />
            <span className="absolute -left-14 bottom-12 h-3.5 w-3.5 rounded-full bg-[radial-gradient(circle_at_30%_30%,#ffffff_0%,#bae6fd_55%,#2589ff_90%)] border border-white/85 shadow-[0_6px_10px_-2px_rgba(11,116,245,0.28)]" />

            <span className="absolute -right-12 top-16 h-5 w-5 rounded-full bg-[radial-gradient(circle_at_30%_30%,#ffffff_0%,#bae6fd_50%,#2589ff_90%)] border border-white/85 shadow-[0_8px_14px_-3px_rgba(11,116,245,0.32)]" />
            <span className="absolute -right-24 top-24 h-7 w-7 rounded-full bg-[radial-gradient(circle_at_30%_30%,#ffffff_0%,#bae6fd_48%,#1c7ef2_88%)] border border-white/85 shadow-[0_10px_18px_-4px_rgba(11,116,245,0.34)]" />
            <span className="absolute -right-20 bottom-16 h-11 w-11 rounded-full bg-[radial-gradient(circle_at_32%_28%,#ffffff_0%,#cbe9ff_46%,#1f7ef5_86%,#e0f2fe_100%)] border border-white/90 shadow-[0_12px_22px_-4px_rgba(11,116,245,0.38),inset_0_2px_5px_rgba(255,255,255,0.95)]" />
            <span className="absolute -right-12 bottom-3 h-4 w-4 rounded-full bg-[radial-gradient(circle_at_30%_30%,#ffffff_0%,#bae6fd_55%,#2589ff_90%)] border border-white/85 shadow-[0_6px_12px_-2px_rgba(11,116,245,0.28)]" />
          </div>

          {/* Frosted glass login card */}
          <div className="relative z-10 w-full rounded-[28px] bg-white/75 backdrop-blur-2xl border border-white/95 ring-1 ring-[#BFDBFE]/70 px-7 sm:px-8 pb-8 pt-11 shadow-[0_24px_60px_-15px_rgba(14,72,162,0.22),inset_0_1px_2px_rgba(255,255,255,0.98)]">
            {/* Top floating 3D glossy user avatar sphere */}
            <div
              aria-hidden="true"
              className="absolute -top-8 left-1/2 -translate-x-1/2 h-16 w-16 rounded-full bg-[radial-gradient(circle_at_32%_24%,#F0F9FF_0%,#7BC6FF_42%,#0D72F3_85%,#084EC2_100%)] border-2 border-white/95 shadow-[0_14px_28px_-6px_rgba(13,114,243,0.5),inset_0_3px_8px_rgba(255,255,255,0.9)] flex items-center justify-center"
            >
              <User className="h-7 w-7 text-white drop-shadow-[0_2px_4px_rgba(8,66,152,0.45)]" strokeWidth={2.2} />
            </div>

            <div className="mb-6 text-center">
              <img
                src={TAPNEX_LOGO_URL}
                alt="TapNex — Smart Connections. One Tap."
                className="h-11 sm:h-12 w-auto mx-auto object-contain"
              />
              <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-[#0F2F5E]">
                Sign in to TapNex
              </h1>
              <p className="mt-1 text-sm text-[#4B6487]">
                Access your Customer, Printer, or Administration workspace.
              </p>
            </div>

            {errorMsg && (
              <div className="mb-5 p-3.5 rounded-2xl bg-rose-50/95 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="button"
              disabled={submitting}
              onClick={handleGoogle}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-full border border-[#C7DDF7] bg-white/85 hover:bg-white text-sm font-semibold text-[#0F2F5E] shadow-[0_6px_16px_-6px_rgba(14,72,162,0.18),inset_0_1px_1px_rgba(255,255,255,0.95)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B74F5] disabled:opacity-50"
            >
              <GoogleLogoIcon />
              <span>Continue with Google</span>
            </button>

            <div className="my-5 flex items-center gap-3 text-xs text-[#647EA3]">
              <span className="h-px flex-1 bg-[#CFE2FA]" />
              <span>or sign in with email</span>
              <span className="h-px flex-1 bg-[#CFE2FA]" />
            </div>

            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-semibold text-[#234372] mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B669C]" />
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-[#C7DDF7] bg-white/75 text-sm text-[#0F2F5E] placeholder:text-[#6B84A6] shadow-[inset_0_1px_2px_rgba(15,64,148,0.06)] focus:bg-white focus:border-[#0B74F5] focus:ring-2 focus:ring-[#0B74F5]/20 focus:outline-none transition-all"
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="block text-xs font-semibold text-[#234372]">
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-[#0B66D4] hover:text-[#004EB3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B74F5] rounded"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B669C]" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 rounded-2xl border border-[#C7DDF7] bg-white/75 text-sm text-[#0F2F5E] placeholder:text-[#6B84A6] shadow-[inset_0_1px_2px_rgba(15,64,148,0.06)] focus:bg-white focus:border-[#0B74F5] focus:ring-2 focus:ring-[#0B74F5]/20 focus:outline-none transition-all"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#4B6B97] hover:text-[#0F2F5E] hover:bg-[#E8F2FE]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B74F5] transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 w-full flex items-center justify-center gap-2 py-3 px-6 rounded-full bg-gradient-to-b from-[#2B92FF] via-[#0B74F5] to-[#0055D4] hover:from-[#3B9DFF] hover:via-[#147EFB] hover:to-[#075EE0] text-white text-sm font-semibold border border-[#60B6FF]/65 shadow-[0_12px_24px_-6px_rgba(11,116,245,0.52),inset_0_1.5px_1px_rgba(255,255,255,0.6)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B74F5] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <LogIn className="h-4 w-4" />
                <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-[#4B6487]">
              New to TapNex?{' '}
              <Link
                to="/register"
                className="font-semibold text-[#0B66D4] hover:text-[#004EB3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B74F5] rounded"
              >
                Create your account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
};

export const RegisterPage: React.FC = () => {
  const { firebaseUser, userRecord, loading, loginWithGoogle, registerWithEmail } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!loading && firebaseUser && userRecord?.role === 'PRINTER') {
    return <Navigate to="/printer/dashboard" replace />;
  }

  const handleGoogle = async () => {
    setErrorMsg('');
    setSubmitting(true);
    try {
      const user = await loginWithGoogle();
      notify('Account ready', 'Signed in with Google.', 'success');
      navigate(getSafeRedirectTarget(searchParams, user.role));
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (fullName.trim().length < 2) {
      setErrorMsg('Please enter your full name.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await registerWithEmail(fullName.trim(), email.trim(), password);
      notify('Verification email sent', 'Please check your inbox to verify your account.', 'success');
      navigate('/verify-email');
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <div className="min-h-[calc(100vh-12rem)] flex items-center justify-center px-4 py-12 bg-gradient-to-b from-[#EDE7FF]/55 via-[#FAF9FE] to-[#FAF9FE]">
        <div className="w-full max-w-md bg-white border border-[#E9E4F5] rounded-2xl p-7 sm:p-8 shadow-xs">
          <div className="mb-5 text-center">
            <img src={TAPNEX_LOGO_URL} alt="TapNex — Smart Connections. One Tap." className="h-14 sm:h-16 w-auto mx-auto object-contain" />
            <h1 className="mt-4 font-display text-2xl font-bold text-[#18142C]">Create your TapNex account</h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Build your digital profile and design your 85.6 × 54 mm SMART business card.
            </p>
          </div>

          {errorMsg && (
            <div className="mt-4 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {errorMsg}
            </div>
          )}

          <button
            type="button"
            disabled={submitting}
            onClick={handleGoogle}
            className="mt-6 w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-800 transition-colors disabled:opacity-50"
          >
            <GoogleLogoIcon />
            <span>Sign up with Google</span>
          </button>

          <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            <span>or register with email</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
                placeholder="e.g., Jeet Kulkarni"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
                placeholder="Minimum 6 characters"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
              <span>{submitting ? 'Creating account...' : 'Create Customer Account'}</span>
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            Already registered?{' '}
            <Link to="/login" className="font-semibold text-[#7C3AED] hover:text-[#6D28D9] hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
};

export const ForgotPasswordPage: React.FC = () => {
  const { requestPasswordReset } = useAuth();
  const { notify } = useToast();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
      notify('Reset email sent', 'Check your inbox for the password reset link.', 'success');
    } catch (err) {
      notify('Unable to send reset email', mapAuthError(err), 'error');
    }
  };

  return (
    <PublicLayout>
      <div className="min-h-[calc(100vh-12rem)] flex items-center justify-center px-4 py-12 bg-gradient-to-b from-[#EDE7FF]/55 via-[#FAF9FE] to-[#FAF9FE]">
        <div className="w-full max-w-md bg-white border border-[#E9E4F5] rounded-2xl p-7 shadow-xs">
          <div className="text-center">
            <img src={TAPNEX_LOGO_URL} alt="TapNex — Smart Connections. One Tap." className="h-12 w-auto mx-auto mb-4 object-contain" />
            <Lock className="h-7 w-7 text-[#7C3AED] mx-auto mb-2.5" />
            <h1 className="font-display text-2xl font-bold text-[#18142C]">Reset Password</h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Enter your registered email address to receive a Firebase password reset link.
            </p>
          </div>
          {sent ? (
            <div className="mt-5 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
              Password reset instructions have been sent to <strong>{email}</strong>.
            </div>
          ) : (
            <form onSubmit={handleReset} className="mt-5 space-y-4">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
                placeholder="you@company.com"
              />
              <button type="submit" className="w-full py-3 rounded-xl bg-[#18142C] hover:bg-[#2A2048] text-white text-sm font-semibold">
                Send Reset Link
              </button>
            </form>
          )}
          <div className="mt-5 text-center">
            <Link to="/login" className="text-sm font-medium text-[#7C3AED] hover:text-[#6D28D9] hover:underline">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
};

export const VerifyEmailPage: React.FC = () => {
  const { firebaseUser, userRecord, resendVerificationEmail, refreshSession, logout } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await refreshSession();
      if (firebaseUser?.emailVerified) {
        notify('Email verified', 'Your portal access is now unlocked.', 'success');
        navigate(getRoleDashboardPath(userRecord?.role));
      } else {
        notify('Not yet verified', 'Please click the verification link in your email inbox first.', 'info');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <PublicLayout>
      <div className="min-h-[calc(100vh-12rem)] flex items-center justify-center px-4 py-12 bg-gradient-to-b from-[#EDE7FF]/55 via-[#FAF9FE] to-[#FAF9FE]">
        <div className="w-full max-w-md bg-white border border-[#E9E4F5] rounded-2xl p-7 text-center shadow-xs">
          <MailCheck className="h-10 w-10 text-[#7C3AED] mx-auto mb-3" />
          <h1 className="font-display text-2xl font-bold text-[#18142C]">Verify Your Email</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Unverified email/password accounts cannot access protected customer features. We sent a verification link to{' '}
            <strong>{firebaseUser?.email || 'your email'}</strong>.
          </p>
          <div className="mt-6 space-y-3">
            <button
              type="button"
              disabled={checking}
              onClick={handleCheck}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#18142C] hover:bg-[#2A2048] text-white text-sm font-semibold"
            >
              <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
              <span>I Verified My Email — Continue</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                await resendVerificationEmail();
                notify('Email resent', 'Check your inbox and spam folder.', 'success');
              }}
              className="w-full py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Resend Verification Email
            </button>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="w-full py-2 text-xs text-slate-500 hover:text-slate-800"
            >
              Sign out and use another account
            </button>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
};
