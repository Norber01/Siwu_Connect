import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { useMe } from '../auth/AuthProvider';
import { db } from '../lib/firebase';
import { useProfileById } from '../lib/hooks';
import { markNotificationsRead } from '../lib/ops';
import { fetchNotifications } from '../lib/queries';
import type { AppNotification } from '../lib/types';
import { friendlyError, timeAgo } from '../lib/util';
import { InviteButton } from '../components/extras';
import { Icon } from '../components/Icon';
import { Avatar, EmptyState, ErrorState, PageHeader, PageSpinner } from '../components/ui';

/** Header bell with a live unread count. */
export function NotificationBell() {
  const { user } = useMe();
  const [unread, setUnread] = useState(0);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'users', user.uid, 'notifications'), where('read', '==', false), limit(20)),
        (s) => setUnread(s.size),
        () => setUnread(0),
      ),
    [user.uid],
  );
  return (
    <NavLink
      to="/notifications"
      className="relative rounded-full p-1.5 text-gray-700 hover:bg-sand-100 aria-[current=page]:text-brand-700"
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Icon name="bell" className="h-6 w-6" />
      {unread > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </NavLink>
  );
}

function NotificationRow({ n }: { n: AppNotification }) {
  const { data: actor } = useProfileById(n.actorId);
  const name = actor?.displayName ?? 'Someone';
  return (
    <li>
      <Link
        to={`/p/${n.postId}${n.type === 'comment' ? '#comments' : ''}`}
        className={`flex items-center gap-3 rounded-2xl p-3 hover:bg-sand-100 ${n.read ? 'bg-white' : 'bg-brand-50'}`}
      >
        <span className="relative">
          <Avatar url={actor?.photoUrl} name={name} size={44} />
          <span className={`absolute -bottom-1 -right-1 rounded-full p-1 text-white ring-2 ring-white ${n.type === 'like' ? 'bg-brand-600' : 'bg-gold-600'}`}>
            <Icon name={n.type === 'like' ? 'thumb' : 'comment'} filled={n.type === 'like'} className="h-3 w-3" />
          </span>
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-bold text-gray-900">{name}</span>{' '}
          <span className="text-gray-700">{n.type === 'like' ? 'liked your post' : 'commented on your post'}</span>
          <span className="block text-xs text-gray-600">{timeAgo(n.createdAt)}</span>
        </span>
        {!n.read && <span className="h-2.5 w-2.5 rounded-full bg-brand-600" aria-label="Unread" />}
      </Link>
    </li>
  );
}

export function NotificationsPage() {
  const { user } = useMe();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => fetchNotifications(user.uid) });

  // Mark everything shown as read (the bell count drops immediately).
  useEffect(() => {
    const unread = (q.data ?? []).filter((n) => !n.read).map((n) => n.id);
    if (unread.length) void markNotificationsRead(db, user.uid, unread).catch(() => {});
  }, [q.data, user.uid]);

  return (
    <div className="space-y-3">
      <PageHeader title="Notifications" back />
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title="No notifications yet" icon="bell">
          When people like or comment on your posts, you'll see it here.
          <div className="mt-4">
            <InviteButton />
          </div>
        </EmptyState>
      ) : (
        <ul className="space-y-1">
          {q.data.map((n) => (
            <NotificationRow key={n.id} n={n} />
          ))}
        </ul>
      )}
    </div>
  );
}
