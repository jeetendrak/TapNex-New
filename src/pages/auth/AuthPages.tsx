import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MailCheck, Lock, UserPlus, LogIn, RefreshCw, ShieldAlert } from 'lucide-react';
import { PublicLayout, TAPNEX_LOGO_URL } from '../../components/PublicLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import type { UserRole } from '../../types';

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

function routeForRole(role: UserRole): string {
  if (role === 'SUPERADMIN') return '/superadmin/dashboard';
  if (role === 'ADMIN') return '/admin/dashboard';
  if (role === 'PRINTER') return '/printer/dashboard';
  return '/dashboard';
}

function getSafeRedirectTarget(searchParams: URLSearchParams, role: UserRole): string {
  const raw = searchParams.get('redirect') || '';
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw;
  }
  return routeForRole(role);
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
      <div className="min-h-[calc(100vh-12rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-7 sm:p-8 shadow-xs">
          <div className="mb-5 text-center">
            <img src={TAPNEX_LOGO_URL} alt="TapNex — Smart Connections. One Tap." className="h-14 sm:h-16 w-auto mx-auto object-contain" />
            <h1 className="mt-4 font-display text-2xl font-bold text-[#0B1D3A]">Sign in to TapNex</h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Access your Customer, Printer, or Administration workspace.
            </p>
          </div>

          {errorMsg && (
            <div className="mt-4 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="button"
            disabled={submitting}
            onClick={handleGoogle}
            className="mt-6 w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-800 transition-colors disabled:opacity-50"
          >
            <GoogleLogoIcon />
            <span>Continue with Google</span>
          </button>

          <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            <span>or sign in with email</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-4">
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
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">Password</label>
                <Link to="/forgot-password" className="text-xs font-medium text-[#1D4ED8] hover:underline">
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#0B1D3A] hover:bg-[#132A52] text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" />
              <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            New to TapNex?{' '}
            <Link to="/register" className="font-semibold text-[#1D4ED8] hover:underline">
              Create your account
            </Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
};

export const RegisterPage: React.FC = () => {
  const { loginWithGoogle, registerWithEmail } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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
      <div className="min-h-[calc(100vh-12rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-7 sm:p-8 shadow-xs">
          <div className="mb-5 text-center">
            <img src={TAPNEX_LOGO_URL} alt="TapNex — Smart Connections. One Tap." className="h-14 sm:h-16 w-auto mx-auto object-contain" />
            <h1 className="mt-4 font-display text-2xl font-bold text-[#0B1D3A]">Create your TapNex account</h1>
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
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#0B1D3A] hover:bg-[#132A52] text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
              <span>{submitting ? 'Creating account...' : 'Create Customer Account'}</span>
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            Already registered?{' '}
            <Link to="/login" className="font-semibold text-[#1D4ED8] hover:underline">
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
      <div className="min-h-[calc(100vh-12rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-7 shadow-xs">
          <div className="text-center">
            <img src={TAPNEX_LOGO_URL} alt="TapNex — Smart Connections. One Tap." className="h-12 w-auto mx-auto mb-4 object-contain" />
            <Lock className="h-7 w-7 text-[#1D4ED8] mx-auto mb-2.5" />
            <h1 className="font-display text-2xl font-bold text-[#0B1D3A]">Reset Password</h1>
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
              <button type="submit" className="w-full py-3 rounded-xl bg-[#0B1D3A] text-white text-sm font-semibold">
                Send Reset Link
              </button>
            </form>
          )}
          <div className="mt-5 text-center">
            <Link to="/login" className="text-sm font-medium text-[#1D4ED8] hover:underline">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
};

export const VerifyEmailPage: React.FC = () => {
  const { firebaseUser, resendVerificationEmail, refreshSession, logout } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await refreshSession();
      if (firebaseUser?.emailVerified) {
        notify('Email verified', 'Your customer portal is now unlocked.', 'success');
        navigate('/dashboard');
      } else {
        notify('Not yet verified', 'Please click the verification link in your email inbox first.', 'info');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <PublicLayout>
      <div className="min-h-[calc(100vh-12rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-7 text-center shadow-xs">
          <MailCheck className="h-10 w-10 text-[#1D4ED8] mx-auto mb-3" />
          <h1 className="font-display text-2xl font-bold text-[#0B1D3A]">Verify Your Email</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Unverified email/password accounts cannot access protected customer features. We sent a verification link to{' '}
            <strong>{firebaseUser?.email || 'your email'}</strong>.
          </p>
          <div className="mt-6 space-y-3">
            <button
              type="button"
              disabled={checking}
              onClick={handleCheck}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#0B1D3A] text-white text-sm font-semibold"
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
