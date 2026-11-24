import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { townName, townShortName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { useFeed } from '../lib/hooks';
import { type Feed as FeedSpec, fetchAnnouncements, fetchMyLikes, fetchPinned, fetchUpcomingEvents } from '../lib/queries';
import type { Announcement } from '../lib/types';
import { friendlyError, timeAgo } from '../lib/util';
import { Icon } from './Icon';
import { PostCard, RichText } from './PostCard';
import { Avatar, Button, EmptyState, ErrorState, PageSpinner } from './ui';

export function Announcements({ townId }: { townId: string | null }) {
  const q = useQuery({
    queryKey: ['announcements', townId],
    queryFn: () => fetchAnnouncements(townId),
    staleTime: 60_000,
  });
  if (!q.data?.length) return null; // announcements are optional; feed errors are shown below
  return (
    <section aria-label="Announcements" className="space-y-3">
      {q.data.map((a) => (
        <AnnouncementCard key={a.id} a={a} />
      ))}
    </section>
  );
}

function AnnouncementCard({ a }: { a: Announcement }) {
  return (
    <article className="rounded-2xl border-l-4 border-gold-400 bg-gold-100 p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gold-800">
        <Icon name="megaphone" className="h-4 w-4" />
        {a.townId === 'all' ? 'All Akpafu' : townName(a.townId)} announcement
        {a.pinned && <Icon name="pin" className="h-3.5 w-3.5" />}
      </div>
      <h2 className="font-bold text-gray-900">{a.title}</h2>
      <div className="mt-1">
        <RichText text={a.body} />
      </div>
      <p className="mt-2 text-xs text-gold-800">{timeAgo(a.createdAt)}</p>
    </article>
  );
}

export function Feed({ feed, emptyTitle, emptyText }: { feed: FeedSpec; emptyTitle: string; emptyText?: React.ReactNode }) {
  const { user, blocked } = useMe();
  const posts = useFeed(feed);
  const pinned = useQuery({
    queryKey: ['pinned', feed],
    queryFn: async () => {
      const items = await fetchPinned(feed);
      return { items, liked: await fetchMyLikes(user.uid, items.map((p) => p.id)) };
    },
    enabled: feed.kind !== 'author',
    staleTime: 60_000,
  });

  if (posts.isPending) return <PageSpinner />;
  if (!posts.data) return <ErrorState message={friendlyError(posts.error)} onRetry={() => posts.refetch()} />;

  const pinnedItems = (pinned.data?.items ?? []).filter((p) => !blocked.has(p.authorId));
  const pinnedIds = new Set(pinnedItems.map((p) => p.id));
  const rows = posts.data.pages.flatMap((page) =>
    page.items.filter((p) => !pinnedIds.has(p.id) && !blocked.has(p.authorId)).map((p) => ({ post: p, liked: page.liked.get(p.id) ?? null })),
  );

  if (!rows.length && !pinnedItems.length) {
    return (
      <EmptyState title={emptyTitle} icon="comment">
        {emptyText}
      </EmptyState>
    );
  }

  return (
    <div className="-mx-4 border-t border-sand-200 px-4">
      {pinnedItems.map((p) => (
        <PostCard key={`pin-${p.id}`} post={p} liked={pinned.data!.liked.get(p.id) ?? null} />
      ))}
      {rows.map(({ post, liked }) => (
        <PostCard key={`${post.id}:${liked ?? ''}`} post={post} liked={liked} />
      ))}
      {posts.isPlaceholderData ? (
        <p className="py-4 text-center text-sm text-gray-500">Getting the latest posts…</p>
      ) : posts.hasNextPage ? (
        <div className="flex justify-center py-2">
          <AutoLoad key={posts.data.pages.length} onVisible={() => !posts.isFetchingNextPage && !posts.isFetchNextPageError && posts.fetchNextPage()} />
          <Button variant="secondary" busy={posts.isFetchingNextPage} onClick={() => posts.fetchNextPage()}>
            Load more posts
          </Button>
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-gray-500">You're all caught up.</p>
      )}
      {posts.isFetchNextPageError && <p className="text-center text-sm text-red-700">{friendlyError(posts.error)}</p>}
    </div>
  );
}

/** Loads the next page shortly before you reach the end of the feed. */
function AutoLoad({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && cb.current(), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <span ref={ref} aria-hidden="true" />;
}

export function CreatePostPrompt({ townId }: { townId?: string }) {
  const { profile } = useMe();
  if (profile.status !== 'active') return null;
  const to = townId ? `/new?town=${townId}` : '/new';
  return (
    <div className="flex items-center gap-3 rounded-full bg-sand-100 p-1.5 pr-2">
      <Avatar url={profile.photoUrl} name={profile.displayName} size={40} />
      <Link to={to} className="flex min-h-[44px] flex-1 items-center text-[15px] text-gray-600">
        What's on your mind?
      </Link>
      <Link to={to} aria-label="Add a photo or video" className="rounded-full p-2 text-brand-600 hover:bg-white">
        <Icon name="camera" className="h-6 w-6" />
      </Link>
    </div>
  );
}

/** Pill buttons under the stories: the main one (gold) writes a post. */
export function QuickActions({ townId }: { townId?: string }) {
  const { profile } = useMe();
  const pill = 'flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold';
  return (
    <nav aria-label="Quick actions" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
      {profile.status === 'active' && (
        <Link to={townId ? `/new?town=${townId}` : '/new'} className={`${pill} bg-gradient-to-b from-gold-400 to-gold-600 text-white shadow-sm`}>
          <Icon name="edit" className="h-4 w-4" /> Post update
        </Link>
      )}
      <Link to="/events" className={`${pill} bg-white text-brand-900 shadow-sm ring-1 ring-sand-200`}>
        Events
      </Link>
      <Link to="/market" className={`${pill} bg-white text-brand-900 shadow-sm ring-1 ring-sand-200`}>
        Marketplace
      </Link>
      <Link to="/directory" className={`${pill} bg-white text-brand-900 shadow-sm ring-1 ring-sand-200`}>
        Jobs & businesses
      </Link>
      <Link to="/sports?tab=predictions" className={`${pill} bg-white text-brand-900 shadow-sm ring-1 ring-sand-200`}>
        Predictions
      </Link>
    </nav>
  );
}

/** "Coming up" strip of the next events, shown on the home feed. */
export function UpcomingEvents({ townId }: { townId: string | null }) {
  const q = useQuery({ queryKey: ['events', townId ?? 'all'], queryFn: () => fetchUpcomingEvents(townId), staleTime: 60_000 });
  const events = (q.data ?? []).slice(0, 8);
  if (!events.length) return null;
  return (
    <section aria-label="Upcoming events" className="rounded-2xl border border-sand-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
          <Icon name="calendar" className="h-4 w-4 text-brand-700" /> Coming up
        </h2>
        <Link to={townId ? `/events?town=${townId}` : '/events'} className="text-xs font-semibold text-brand-700 hover:underline">
          All events →
        </Link>
      </div>
      <ul className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
        {events.map((e) => (
          <li key={e.id} className="w-56 shrink-0">
            <Link to={`/events/${e.id}`} className="block overflow-hidden rounded-xl border border-sand-200 hover:border-brand-300">
              {e.imageUrl ? (
                <img src={e.imageUrl} alt="" loading="lazy" className="h-24 w-full object-cover" />
              ) : (
                <div className="flex h-24 items-center justify-center bg-brand-50 text-brand-300">
                  <Icon name="calendar" className="h-10 w-10" />
                </div>
              )}
              <div className="p-2">
                <p className="text-[11px] font-bold uppercase text-brand-700">
                  {e.startsAt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {townShortName(e.townId)}
                </p>
                <p className="truncate text-sm font-bold text-gray-900">{e.title}</p>
                <p className="text-xs text-gray-600">{e.goingCount} going</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
