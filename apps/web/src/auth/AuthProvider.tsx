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
  // The profile is stored together with the uid it belongs to, so a value left over from a
  // previous account (or from being signed out) is never shown for a newly signed-in user.
  const [profileState, setProfileState] = useState<{ uid: string | null; profile: Profile | null | undefined }>({
    uid: null,
    profile: undefined,
  });
  const [role, setRole] = useState<AdminRole | null>(null);
  const [blocked, setBlockedSet] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setProfileState({ uid: null, profile: user === null ? null : undefined });
      setRole(null);
      setBlockedSet(new Set());
      return;
    }
    const uid = user.uid;
    const setProfile = (p: Profile | null) => setProfileState({ uid, profile: p });
    let stopped = false;
    let confirmed = false;
    let unsubProfile = () => {};
    let unsubRole = () => {};
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Right after switching accounts the database can briefly still see the previous
    // sign-in and refuse a listener. Retry instead of treating that as "no profile".
    const retry = (fn: () => void, attempt: number) => {
      if (!stopped) timers.push(setTimeout(fn, Math.min(500 * 2 ** attempt, 10_000)));
    };

    const listenProfile = (attempt = 0) => {
      unsubProfile = onSnapshot(
        doc(db, 'users', uid),
        { includeMetadataChanges: true },
        (snap) => {
          // A "does not exist" answer from the local cache can be stale (e.g. right after sign-up
          // or switching accounts). Only trust "no profile" when the server confirms it.
          if (!snap.exists() && snap.metadata.fromCache) return;
          // A brand-new profile is only trusted once the server has accepted it.
          if (snap.exists() && snap.metadata.hasPendingWrites && !confirmed) return;
          confirmed = snap.exists();
          setProfile(snap.exists() ? toProfile(snap) : null);
        },
        () => retry(() => listenProfile(attempt + 1), attempt),
      );
    };
    const listenRole = (attempt = 0) => {
      unsubRole = onSnapshot(
        doc(db, 'admin_roles', uid),
        (snap) => setRole(snap.exists() ? { role: snap.data().role, townIds: snap.data().townIds ?? [] } : null),
        () => retry(() => listenRole(attempt + 1), attempt),
      );
    };
    listenProfile();
    listenRole();
    fetchBlocked(uid)
      .then(setBlockedSet)
      .catch(() => setBlockedSet(new Set()));
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      unsubProfile();
      unsubRole();
    };
    // Re-subscribe only when the signed-in account changes, not on token refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user === null]);

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

  const profile: Profile | null | undefined =
    user === undefined ? undefined : user === null ? null : profileState.uid === user.uid ? profileState.profile : undefined;

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
