import { type User, onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminRole } from '@siwu/shared';
import { auth, db } from '../lib/firebase';
import { fetchBlocked } from '../lib/queries';
import { type Profile, toProfile } from '../lib/types';

interface AuthState {
  /** undefined while loading */
  user: User | null | undefined;
  /** undefined while loading, null when the user has not completed onboarding */
  profile: Profile | null | undefined;
  role: AdminRole | null;
  blocked: Set<string>;
  setBlocked: (uid: string, blocked: boolean) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [blocked, setBlockedSet] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setProfile(user === null ? null : undefined);
      setRole(null);
      setBlockedSet(new Set());
      return;
    }
    setProfile(undefined);
    const unsubProfile = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => setProfile(snap.exists() ? toProfile(snap) : null),
      () => setProfile(null),
    );
    const unsubRole = onSnapshot(
      doc(db, 'admin_roles', user.uid),
      (snap) => setRole(snap.exists() ? { role: snap.data().role, townIds: snap.data().townIds ?? [] } : null),
      () => setRole(null),
    );
    fetchBlocked(user.uid)
      .then(setBlockedSet)
      .catch(() => setBlockedSet(new Set()));
    return () => {
      unsubProfile();
      unsubRole();
    };
  }, [user]);

  const setBlocked = useCallback((uid: string, isBlocked: boolean) => {
    setBlockedSet((prev) => {
      const next = new Set(prev);
      if (isBlocked) next.add(uid);
      else next.delete(uid);
      return next;
    });
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, profile, role, blocked, setBlocked, signOut }),
    [user, profile, role, blocked, setBlocked, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For screens that are only rendered after sign-in + onboarding. */
export function useMe(): { user: User; profile: Profile; role: AdminRole | null; blocked: Set<string> } {
  const { user, profile, role, blocked } = useAuth();
  if (!user || !profile) throw new Error('useMe used before sign-in completed');
  return { user, profile, role, blocked };
}
