import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { type Feed, fetchFeedPage, fetchMyLikes, fetchProfile } from './queries';

/** Author profiles are cached for 5 minutes, so a feed costs at most one read per distinct author. */
export function useProfileById(uid: string | null | undefined) {
  return useQuery({
    queryKey: ['profile', uid],
    queryFn: () => fetchProfile(uid!),
    enabled: !!uid,
    staleTime: 5 * 60_000,
  });
}

export function feedKey(feed: Feed): unknown[] {
  if (feed.kind === 'town') return ['feed', 'town', feed.townId];
  if (feed.kind === 'author') return ['feed', 'author', feed.uid];
  return ['feed', 'akpafu'];
}

/** The first page as saved on this phone last time (no network), shown while fresh posts load. */
function useCachedFirstPage(feed: Feed, uid: string | undefined) {
  return useQuery({
    queryKey: ['feedCache', ...feedKey(feed)],
    queryFn: async () => {
      const page = await fetchFeedPage(feed, null, true);
      if (!page.items.length) return null;
      const liked = uid ? await fetchMyLikes(uid, page.items.map((p) => p.id), true).catch(() => new Map<string, string>()) : new Map<string, string>();
      return { ...page, cursor: null, liked };
    },
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  });
}

export function useFeed(feed: Feed) {
  const { user } = useAuth();
  const cached = useCachedFirstPage(feed, user?.uid);
  return useInfiniteQuery({
    placeholderData: cached.data ? { pages: [cached.data], pageParams: [null] } : undefined,
    queryKey: feedKey(feed),
    initialPageParam: null as Awaited<ReturnType<typeof fetchFeedPage>>['cursor'],
    queryFn: async ({ pageParam }) => {
      const page = await fetchFeedPage(feed, pageParam);
      const liked = user ? await fetchMyLikes(user.uid, page.items.map((p) => p.id)) : new Map<string, string>();
      return { ...page, liked };
    },
    getNextPageParam: (last) => last.cursor ?? undefined,
    staleTime: 30_000,
  });
}

/** Refreshes every list that may contain posts after a change. */
export function useInvalidatePosts() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['feed'] });
    void qc.invalidateQueries({ queryKey: ['pinned'] });
    void qc.invalidateQueries({ queryKey: ['post'] });
    void qc.invalidateQueries({ queryKey: ['search'] });
  }, [qc]);
}
