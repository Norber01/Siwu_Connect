import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { townName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { useFeed } from '../lib/hooks';
import { type Feed as FeedSpec, fetchAnnouncements, fetchMyLikes, fetchPinned } from '../lib/queries';
import type { Announcement } from '../lib/types';
import { friendlyError, timeAgo } from '../lib/util';
import { Icon } from './Icon';
import { PostCard, RichText } from './PostCard';
import { Button, EmptyState, ErrorState, PageSpinner } from './ui';

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
    <article className="rounded-2xl border border-gold-400/50 bg-gold-100 p-4">
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
    page.items.filter((p) => !pinnedIds.has(p.id) && !blocked.has(p.authorId)).map((p) => ({ post: p, liked: page.liked.has(p.id) })),
  );

  if (!rows.length && !pinnedItems.length) {
    return (
      <EmptyState title={emptyTitle} icon="comment">
        {emptyText}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      {pinnedItems.map((p) => (
        <PostCard key={`pin-${p.id}`} post={p} liked={pinned.data!.liked.has(p.id)} />
      ))}
      {rows.map(({ post, liked }) => (
        <PostCard key={post.id} post={post} liked={liked} />
      ))}
      {posts.hasNextPage ? (
        <div className="flex justify-center py-2">
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

export function CreatePostPrompt({ townId }: { townId?: string }) {
  const { profile } = useMe();
  if (profile.status !== 'active') return null;
  return (
    <Link
      to={townId ? `/new?town=${townId}` : '/new'}
      className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-sand-200 bg-white px-4 text-gray-500 hover:border-brand-300"
    >
      <Icon name="edit" />
      <span>Share news, a question or an update…</span>
    </Link>
  );
}
