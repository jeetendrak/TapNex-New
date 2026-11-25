import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { BOOTSTRAPPED_SUPERADMIN_EMAIL, DEFAULT_APP_SETTINGS } from '../lib/constants';
import {
  ensureDefaultProfile,
  getAppSettings,
  seedInitialCatalogIfEmpty,
} from '../lib/firestoreService';
import type { AppSettingsRecord, UserRecord, UserRole } from '../types';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  userRecord: UserRecord | null;
  appSettings: AppSettingsRecord;
  loading: boolean;
  isBlocked: boolean;
  needsEmailVerification: boolean;
  loginWithGoogle: () => Promise<UserRecord>;
  loginWithEmail: (email: string, password: string) => Promise<UserRecord>;
  registerWithEmail: (fullName: string, email: string, password: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userRecord, setUserRecord] = useState<UserRecord | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettingsRecord>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);
  const inflightSyncRef = useRef<Map<string, Promise<UserRecord>>>(new Map());

  const refreshSettings = useCallback(async () => {
    const s = await getAppSettings();
    setAppSettings(s);
  }, []);

  const syncUserDocument = useCallback((fbUser: FirebaseUser): Promise<UserRecord> => {
    const existingFlight = inflightSyncRef.current.get(fbUser.uid);
    if (existingFlight) return existingFlight;

    const run = (async (): Promise<UserRecord> => {
      const isBootstrappedSuperAdmin =
        fbUser.emailVerified && fbUser.email?.toLowerCase() === BOOTSTRAPPED_SUPERADMIN_EMAIL.toLowerCase();

      const userRef = doc(db, 'users', fbUser.uid);
      let snap = await getDoc(userRef);

      let resolvedRole: UserRole = isBootstrappedSuperAdmin ? 'SUPERADMIN' : 'USER';
      const resolvedStatus: UserRecord['status'] = fbUser.emailVerified ? 'Active' : 'Pending Verification';

      // Verify authoritative admin registry if present
      try {
        const adminSnap = await getDoc(doc(db, 'admins', fbUser.uid));
        if (adminSnap.exists() && adminSnap.data()?.active) {
          resolvedRole = adminSnap.data()?.role as UserRole;
        }
      } catch {
        // Ignore if not admin
      }

      if (!snap.exists()) {
        const safeEmail = (fbUser.email || `${fbUser.uid}@users.tapnex.local`).slice(0, 254);
        const safeUsername = (safeEmail.split('@')[0] || fbUser.uid.slice(0, 8)).slice(0, 64);
        const safeDisplayName = (fbUser.displayName || safeUsername || 'Customer').slice(0, 120);
        const safePhotoUrl = fbUser.photoURL && fbUser.photoURL.length <= 2048 ? fbUser.photoURL : '';

        const newUser: UserRecord = {
          uid: fbUser.uid,
          username: safeUsername,
          email: safeEmail,
          displayName: safeDisplayName,
          photoURL: safePhotoUrl,
          role: resolvedRole,
          status: resolvedStatus,
          emailVerified: fbUser.emailVerified,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        };

        try {
          await setDoc(userRef, newUser);
        } catch (err) {
          // If a concurrent login/tab created the doc right before this write, read it instead of failing
          const retrySnap = await getDoc(userRef).catch(() => null);
          if (retrySnap && retrySnap.exists()) {
            snap = retrySnap;
          } else {
            throw err;
          }
        }

        if (!snap.exists()) {
          if (isBootstrappedSuperAdmin) {
            await setDoc(doc(db, 'admins', fbUser.uid), {
              uid: fbUser.uid,
              email: safeEmail,
              role: 'SUPERADMIN',
              active: true,
              permissions: [],
              updatedAt: serverTimestamp(),
            }).catch(() => null);
          }
          if (fbUser.emailVerified) {
            await ensureDefaultProfile(newUser).catch((err) => {
              console.warn('Default profile setup warning:', err);
            });
            await seedInitialCatalogIfEmpty({ uid: fbUser.uid, email: safeEmail, role: resolvedRole }).catch(() => null);
          }
          return newUser;
        }
      }

      const existing = snap.data() as UserRecord;
      const effectiveRole: UserRole = isBootstrappedSuperAdmin ? 'SUPERADMIN' : existing.role;
      const effectiveStatus =
        existing.status === 'Blocked' || existing.status === 'Disabled'
          ? existing.status
          : fbUser.emailVerified
            ? 'Active'
            : 'Pending Verification';

      if (
        existing.emailVerified !== fbUser.emailVerified ||
        (existing.status === 'Pending Verification' && fbUser.emailVerified)
      ) {
        await updateDoc(userRef, {
          emailVerified: fbUser.emailVerified,
          ...(existing.status === 'Pending Verification' && fbUser.emailVerified ? { status: 'Active' } : {}),
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch(() => null);
      }

      const merged: UserRecord = {
        ...existing,
        role: effectiveRole,
        status: effectiveStatus,
        emailVerified: fbUser.emailVerified,
      };

      if (fbUser.emailVerified && effectiveStatus === 'Active') {
        await ensureDefaultProfile(merged).catch(() => null);
        await seedInitialCatalogIfEmpty({ uid: fbUser.uid, email: merged.email, role: effectiveRole }).catch(() => null);
      }
      return merged;
    })().finally(() => {
      inflightSyncRef.current.delete(fbUser.uid);
    });

    inflightSyncRef.current.set(fbUser.uid, run);
    return run;
  }, []);

  useEffect(() => {
    refreshSettings();
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (!fbUser) {
        setUserRecord(null);
        setLoading(false);
        return;
      }
      try {
        const record = await syncUserDocument(fbUser);
        setUserRecord(record);
      } catch (err) {
        console.error('Auth sync error:', err);
        setUserRecord(null);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [syncUserDocument, refreshSettings]);

  const loginWithGoogle = async (): Promise<UserRecord> => {
    const cred = await signInWithPopup(auth, googleProvider);
    const record = await syncUserDocument(cred.user);
    setUserRecord(record);
    return record;
  };

  const loginWithEmail = async (email: string, password: string): Promise<UserRecord> => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const record = await syncUserDocument(cred.user);
    setUserRecord(record);
    return record;
  };

  const registerWithEmail = async (fullName: string, email: string, password: string): Promise<void> => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: fullName });
    await sendEmailVerification(cred.user);
    const record = await syncUserDocument(cred.user);
    setUserRecord(record);
  };

  const resendVerificationEmail = async (): Promise<void> => {
    if (!auth.currentUser) throw new Error('No active session.');
    await sendEmailVerification(auth.currentUser);
  };

  const requestPasswordReset = async (email: string): Promise<void> => {
    await sendPasswordResetEmail(auth, email);
  };

  const refreshSession = async (): Promise<void> => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    const updated = auth.currentUser;
    setFirebaseUser(updated);
    const record = await syncUserDocument(updated);
    setUserRecord(record);
  };

  const logout = async (): Promise<void> => {
    await signOut(auth);
    setUserRecord(null);
    setFirebaseUser(null);
  };

  const isBlocked = Boolean(userRecord && (userRecord.status === 'Blocked' || userRecord.status === 'Disabled'));
  const needsEmailVerification = Boolean(firebaseUser && !firebaseUser.emailVerified);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userRecord,
        appSettings,
        loading,
        isBlocked,
        needsEmailVerification,
        loginWithGoogle,
        loginWithEmail,
        registerWithEmail,
        resendVerificationEmail,
        requestPasswordReset,
        refreshSession,
        logout,
        refreshSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
