import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { townShortName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { fetchBirthdaysToday, fetchVisitingHome } from '../lib/queries';
import type { Profile } from '../lib/types';
import { Avatar } from './ui';

function PeopleStrip({ title, people, note }: { title: string; people: Profile[]; note: (p: Profile) => string }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-sand-200 bg-white p-3 shadow-sm">
      <h2 className="mb-2 text-sm font-bold text-gray-900">{title}</h2>
      <ul className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
        {people.map((p) => (
          <li key={p.uid} className="w-24 shrink-0 text-center">
            <Link to={`/u/${p.username}`} className="block">
              <span className="inline-block rounded-full ring-2 ring-gold-400">
                <Avatar url={p.photoUrl} name={p.displayName} size={52} />
              </span>
              <span className="mt-1 block truncate text-xs font-semibold text-gray-800">{p.displayName.split(' ')[0]}</span>
              <span className="block truncate text-[11px] text-gray-600">{note(p)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "🎂 Birthdays today" — members who chose to share their birthday. */
export function BirthdaysToday() {
  const { blocked } = useMe();
  const q = useQuery({ queryKey: ['birthdaysToday'], queryFn: fetchBirthdaysToday, staleTime: 30 * 60_000 });
  const people = (q.data ?? []).filter((p) => !blocked.has(p.uid));
  if (!people.length) return null;
  return <PeopleStrip title="🎂 Birthdays today — say happy birthday!" people={people} note={(p) => townShortName(p.hometownId)} />;
}

/** "🏡 Home right now" — members visiting home (e.g. from abroad). */
export function VisitingHome() {
  const { user, blocked } = useMe();
  const q = useQuery({ queryKey: ['visitingHome'], queryFn: fetchVisitingHome, staleTime: 10 * 60_000 });
  const people = (q.data ?? []).filter((p) => !blocked.has(p.uid) && p.uid !== user.uid);
  if (!people.length) return null;
  return (
    <PeopleStrip
      title="🏡 Home right now"
      people={people}
      note={(p) => `${townShortName(p.homeVisitTown ?? '')} · ${p.homeVisitUntil?.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) ?? ''}`}
    />
  );
}
