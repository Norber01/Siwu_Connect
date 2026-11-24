import { useSyncExternalStore } from 'react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { useMe } from '../auth/AuthProvider';
import { db } from './firebase';

export interface Friendship {
  otherUid: string;
  status: 'pending' | 'accepted';
  /** true when the other person sent the request (so you can accept it). */
  incoming: boolean;
  createdAt: Date | null;
}

interface Store {
  uid: string;
  data: Map<string, Friendship> | null;
  error: unknown;
  listeners: Set<() => void>;
  unsub: (() => void) | null;
}

let store: Store | null = null;

/** One shared live listener on my friendships, however many components use it. */
function getStore(uid: string): Store {
  if (store && store.uid === uid) return store;
  store?.unsub?.();
  const s: Store = { uid, data: null, error: null, listeners: new Set(), unsub: null };
  s.unsub = onSnapshot(
    query(collection(db, 'friendships'), where('members', 'array-contains', uid)),
    (snap) => {
      const m = new Map<string, Friendship>();
      for (const d of snap.docs) {
        const x = d.data() as { members: string[]; requesterId: string; status: Friendship['status']; createdAt?: { toDate(): Date } };
        const other = x.members.find((u) => u !== uid);
        if (!other) continue;
        m.set(other, { otherUid: other, status: x.status, incoming: x.requesterId !== uid, createdAt: x.createdAt?.toDate() ?? null });
      }
      s.data = m;
      s.error = null;
      s.listeners.forEach((l) => l());
    },
    (e) => {
      s.error = e;
      s.data = s.data ?? new Map();
      s.listeners.forEach((l) => l());
    },
  );
  store = s;
  return s;
}

export function useFriendships() {
  const { user } = useMe();
  const s = getStore(user.uid);
  const data = useSyncExternalStore(
    (cb) => {
      s.listeners.add(cb);
      return () => s.listeners.delete(cb);
    },
    () => s.data,
  );
  const all = data ?? new Map<string, Friendship>();
  const list = [...all.values()];
  return {
    loading: data === null,
    error: s.error,
    get: (uid: string) => all.get(uid) ?? null,
    friends: list.filter((f) => f.status === 'accepted').map((f) => f.otherUid),
    incoming: list.filter((f) => f.status === 'pending' && f.incoming),
    outgoing: list.filter((f) => f.status === 'pending' && !f.incoming),
  };
}

/** Clear the shared listener (e.g. on sign-out). */
export function resetFriendships() {
  store?.unsub?.();
  store = null;
}

/** My friends' ids, read fresh from the server (used when posting a story). */
export async function fetchFriendIds(uid: string): Promise<string[]> {
  const snap = await getDocs(query(collection(db, 'friendships'), where('members', 'array-contains', uid), where('status', '==', 'accepted')));
  return snap.docs.map((d) => (d.data().members as string[]).find((m) => m !== uid)).filter((x): x is string => !!x);
}
