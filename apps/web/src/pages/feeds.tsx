import { Link, useParams, useSearchParams } from 'react-router-dom';
import { TOWNS, isTownId, townName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { Announcements, CreatePostPrompt, Feed, QuickActions, UpcomingEvents } from '../components/Feed';
import { TownChips } from '../components/TownChips';
import { Landscape } from '../components/Brand';
import { NewMembers } from '../components/extras';
import { WordOfTheDay } from '../components/WordOfTheDay';
import { BirthdaysToday, VisitingHome } from '../components/CommunityCards';
import { TesterChecklist } from '../components/TesterChecklist';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorState, PageHeader, PageSpinner } from '../components/ui';
import { PostCard } from '../components/PostCard';
import { StoriesBar } from './stories';
import { useQuery } from '@tanstack/react-query';
import { fetchMyLikes, fetchTagPosts } from '../lib/queries';
import { friendlyError } from '../lib/util';

export function HomePage() {
  const { profile } = useMe();
  const [params, setParams] = useSearchParams();
  const requested = params.get('town');
  const selected = requested === 'all' || isTownId(requested) ? requested : profile.hometownId;

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{selected === 'all' ? 'All Akpafu feed' : `${townName(selected)} feed`}</h1>
      <div className="rounded-3xl bg-gradient-to-b from-sky-100 to-white/60 px-4 pb-2 pt-3 shadow-sm ring-1 ring-white">
        <StoriesBar />
      </div>
      <QuickActions townId={selected === 'all' ? undefined : selected} />
      <TesterChecklist />
      <BirthdaysToday />
      <VisitingHome />
      <TownChips
        variant="tabs"
        value={selected}
        onChange={(v) => setParams(v === profile.hometownId ? {} : { town: v }, { replace: true })}
      />
      <Announcements townId={selected === 'all' ? null : selected} />
      <WordOfTheDay />
      <UpcomingEvents townId={selected === 'all' ? null : selected} />
      <NewMembers />
      {selected === 'all' ? (
        <Feed
          key="all"
          feed={{ kind: 'akpafu' }}
          emptyTitle="No posts yet"
          emptyText="Public posts from all five towns will appear here."
        />
      ) : (
        <Feed
          key={selected}
          feed={{ kind: 'town', townId: selected }}
          emptyTitle={`No posts in ${townName(selected)} yet`}
          emptyText="Be the first to share news or ask a question."
        />
      )}
    </div>
  );
}

export function TownsPage() {
  const { profile } = useMe();
  return (
    <div>
      <PageHeader title="Towns" />
      <ul className="grid gap-3 sm:grid-cols-2">
        {TOWNS.map((t) => (
          <li key={t.id}>
            <Link
              to={`/towns/${t.id}`}
              className="block overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm hover:border-brand-300"
            >
              <div className="h-20 overflow-hidden">
                <Landscape />
              </div>
              <div className="flex items-center justify-between bg-brand-800 px-4 py-3 text-white">
                <span>
                  <span className="block text-lg font-bold">{t.name}</span>
                  {profile.hometownId === t.id && (
                    <span className="mt-0.5 inline-block rounded-full bg-gold-400 px-2 py-0.5 text-xs font-bold text-[#0f2f41]">
                      Your hometown
                    </span>
                  )}
                </span>
                <Icon name="back" className="h-5 w-5 rotate-180 opacity-80" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        to="/?town=all"
        className="mt-3 flex min-h-[56px] items-center justify-between rounded-2xl bg-gold-400 px-4 font-bold text-[#0f2f41] shadow-sm hover:bg-gold-600"
      >
        <span className="flex items-center gap-2">
          <Icon name="globe" /> All Akpafu — five towns, one community
        </span>
        <Icon name="back" className="h-5 w-5 rotate-180" />
      </Link>
    </div>
  );
}

export function TownPage() {
  const { townId = '' } = useParams();
  if (!isTownId(townId)) {
    return <EmptyState title="Town not found" icon="towns">Choose one of the five towns from the Towns page.</EmptyState>;
  }
  return (
    <div className="space-y-4">
      <PageHeader title={townName(townId)} back />
      <div className="-mt-1 overflow-hidden rounded-2xl">
        <div className="h-16 overflow-hidden">
          <Landscape />
        </div>
      </div>
      <CreatePostPrompt townId={townId} />
      <Announcements townId={townId} />
      <Feed
        key={townId}
        feed={{ kind: 'town', townId }}
        emptyTitle={`No posts in ${townName(townId)} yet`}
        emptyText="Be the first to share news or ask a question."
      />
    </div>
  );
}

export function TagPage() {
  const { tag = '' } = useParams();
  const { user, blocked } = useMe();
  const q = useQuery({
    queryKey: ['tag', tag],
    queryFn: async () => {
      const items = await fetchTagPosts(tag.toLowerCase());
      return { items, liked: await fetchMyLikes(user.uid, items.map((p) => p.id)) };
    },
  });
  return (
    <div className="space-y-3">
      <PageHeader title={<span className="text-brand-700">#{tag}</span>} back />
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title={`No posts with #${tag} yet`} icon="search">
          Start the conversation: write a post and include #{tag}.
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
