import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { townShortName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { searchPeople } from '../lib/queries';
import { Avatar } from './ui';
import { VerifiedBadge } from './VerifiedBadge';

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Member suggestions while typing in a search box (any part of a name works). */
export function PeopleSuggest({ text, onPick, max = 5 }: { text: string; onPick?: () => void; max?: number }) {
  const { user, blocked } = useMe();
  const term = useDebounced(text.trim());
  const q = useQuery({ queryKey: ['search', 'people', term], queryFn: () => searchPeople(term), enabled: term.replace(/^@/, '').length >= 2, staleTime: 60_000 });
  const people = (q.data ?? []).filter((p) => p.uid !== user.uid && !blocked.has(p.uid)).slice(0, max);
  if (text.trim().replace(/^@/, '').length < 2 || !people.length) return null;
  return (
    <ul aria-label="People suggestions" className="overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-sand-200">
      {people.map((p) => (
        <li key={p.uid}>
          <Link to={`/u/${p.username}`} onClick={onPick} className="flex items-center gap-3 px-3 py-2 hover:bg-sand-100">
            <Avatar url={p.photoUrl} name={p.displayName} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-gray-900">
                {p.displayName} {p.verified && <VerifiedBadge className="h-3.5 w-3.5" />}
              </span>
              <span className="block truncate text-xs text-gray-600">
                @{p.username} · {townShortName(p.hometownId)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
