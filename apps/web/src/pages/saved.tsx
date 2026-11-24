import { useQuery } from '@tanstack/react-query';
import { useMe } from '../auth/AuthProvider';
import { useBookmarks } from '../lib/bookmarks';
import { fetchMyLikes, fetchSavedPosts } from '../lib/queries';
import { friendlyError } from '../lib/util';
import { PostCard } from '../components/PostCard';
import { EmptyState, ErrorState, PageHeader, PageSpinner } from '../components/ui';

/** Posts you saved with "Save post" (only you can see this list). */
export function SavedPage() {
  const { user, blocked } = useMe();
  const marks = useBookmarks();
  const q = useQuery({
    queryKey: ['saved', user.uid, marks.size],
    queryFn: async () => {
      const items = await fetchSavedPosts(user.uid);
      return { items, liked: await fetchMyLikes(user.uid, items.map((p) => p.id)) };
    },
  });
  return (
    <div>
      <PageHeader title="Saved" back />
      <p className="-mt-2 mb-3 text-sm text-gray-600">Posts you saved. Only you can see this list.</p>
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="Nothing saved yet" icon="bookmark">
          Tap ⋯ on any post and choose <strong>Save post</strong> to keep it here.
        </EmptyState>
      ) : (
        <div className="-mx-4 border-t border-sand-200 px-4">
          {q.data.items
            .filter((p) => !blocked.has(p.authorId))
            .map((p) => (
              <PostCard key={p.id} post={p} liked={q.data.liked.get(p.id) ?? null} />
            ))}
        </div>
      )}
    </div>
  );
}
