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

/** Live count of unread notifications. */
export function useUnreadNotifications(): number {
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
  return unread;
}

export function CountBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="absolute -right-2 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-white">
      {n > 9 ? '9+' : n}
    </span>
  );
}

/** Header bell with a live unread count. */
export function NotificationBell() {
  const unread = useUnreadNotifications();
  return (
    <NavLink
      to="/notifications"
      className="relative rounded-full p-1.5 text-gray-700 hover:bg-sand-100 aria-[current=page]:text-brand-700"
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Icon name="bell" className="h-6 w-6" />
      <CountBadge n={unread} />
    </NavLink>
  );
}

function notificationLink(n: AppNotification, actorUsername: string | undefined): string {
  if (n.type === 'friend_request') return '/chat';
  if (n.type === 'verified') return '/me';
  if (n.type === 'friend_accepted') return actorUsername ? `/u/${actorUsername}` : '/chat';
  if (n.type === 'approved' || n.type === 'rejected') {
    const [col, id] = (n.targetPath ?? '').split('/');
    return col === 'listings' ? `/market/${id}` : col === 'directory' ? `/directory/${id}` : '/';
  }
  return `/p/${n.postId}${n.type === 'comment' ? '#comments' : ''}`;
}

function NotificationRow({ n }: { n: AppNotification }) {
  const { data: actor } = useProfileById(n.actorId);
  const name = actor?.displayName ?? 'Someone';
  const approval = n.type === 'approved' || n.type === 'rejected';
  const icon =
    n.type === 'repost'
      ? 'repeat'
      : n.type === 'verified'
        ? 'check'
        : n.type === 'like'
          ? 'thumb'
          : n.type.startsWith('friend')
            ? 'user'
            : approval
              ? n.type === 'approved'
                ? 'check'
                : 'close'
              : 'comment';
  const color =
    n.type === 'like' || n.type === 'approved'
      ? 'bg-brand-600'
      : n.type === 'rejected'
        ? 'bg-red-600'
        : n.type.startsWith('friend')
          ? 'bg-blue-600'
          : 'bg-gold-600';
  const text =
    n.type === 'like'
      ? 'reacted to your post'
      : n.type === 'mention'
        ? 'mentioned you in a post'
        : n.type === 'repost'
          ? 'reposted your post 🔁'
          : n.type === 'friend_request'
            ? "sent you a friend request. Accept it to chat and see each other's stories."
            : n.type === 'friend_accepted'
              ? 'accepted your friend request. You can now chat 🎉'
              : n.type === 'comment'
                ? 'commented on your post'
                : n.type === 'verified'
                  ? 'verified your account. Everyone now sees the blue tick next to your name ✔'
                  : '';
  return (
    <li>
      <Link
        to={notificationLink(n, actor?.username)}
        className={`flex items-center gap-3 rounded-2xl p-3 hover:bg-sand-100 ${n.read ? 'bg-white' : 'bg-brand-50'}`}
      >
        <span className="relative">
          {approval ? (
            <span className={`flex h-11 w-11 items-center justify-center rounded-full ${color} text-white`}>
              <Icon name={icon} className="h-5 w-5" />
            </span>
          ) : (
            <>
              <Avatar url={actor?.photoUrl} name={name} size={44} />
              <span className={`absolute -bottom-1 -right-1 rounded-full p-1 text-white ring-2 ring-white ${color}`}>
                <Icon name={icon} filled={n.type === 'like'} className="h-3 w-3" />
              </span>
            </>
          )}
        </span>
        <span className="min-w-0 flex-1 text-sm">
          {approval ? (
            <span className="text-gray-800">
              {n.type === 'approved' ? '✅ Approved and now live: ' : '❌ Not approved: '}
              <strong>{n.title}</strong>
              {n.note ? <span className="block text-gray-600">Moderator's note: {n.note}</span> : null}
            </span>
          ) : (
            <>
              <span className="font-bold text-gray-900">{name}</span> <span className="text-gray-700">{text}</span>
            </>
          )}
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
