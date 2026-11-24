import { useSyncExternalStore } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useMe } from '../auth/AuthProvider';
import { db } from './firebase';

interface Store {
  uid: string;
  ids: Set<string> | null;
  listeners: Set<() => void>;
}
let store: Store | null = null;

function getStore(uid: string): Store {
  if (store && store.uid === uid) return store;
  const s: Store = { uid, ids: null, listeners: new Set() };
  onSnapshot(
    collection(db, 'users', uid, 'bookmarks'),
    (snap) => {
      s.ids = new Set(snap.docs.map((d) => d.id));
      s.listeners.forEach((l) => l());
    },
    () => {
      s.ids = s.ids ?? new Set();
      s.listeners.forEach((l) => l());
    },
  );
  store = s;
  return s;
}

/** Which posts I have saved (one shared live listener). */
export function useBookmarks(): Set<string> {
  const { user } = useMe();
  const s = getStore(user.uid);
  const ids = useSyncExternalStore(
    (cb) => {
      s.listeners.add(cb);
      return () => s.listeners.delete(cb);
    },
    () => s.ids,
  );
  return ids ?? EMPTY;
}
const EMPTY = new Set<string>();
