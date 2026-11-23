import { Link, useParams, useSearchParams } from 'react-router-dom';
import { TOWNS, isTownId, townName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { Announcements, CreatePostPrompt, Feed } from '../components/Feed';
import { TownChips } from '../components/TownChips';
import { Landscape } from '../components/Brand';
import { NewMembers } from '../components/extras';
import { Icon } from '../components/Icon';
import { EmptyState, PageHeader } from '../components/ui';

export function HomePage() {
  const { profile } = useMe();
  const [params, setParams] = useSearchParams();
  const requested = params.get('town');
  const selected = requested === 'all' || isTownId(requested) ? requested : profile.hometownId;

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{selected === 'all' ? 'All Akpafu feed' : `${townName(selected)} feed`}</h1>
      <TownChips
        value={selected}
        onChange={(v) => setParams(v === profile.hometownId ? {} : { town: v }, { replace: true })}
      />
      <CreatePostPrompt townId={selected === 'all' ? undefined : selected} />
      <Announcements townId={selected === 'all' ? null : selected} />
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
                    <span className="mt-0.5 inline-block rounded-full bg-gold-400 px-2 py-0.5 text-xs font-bold text-brand-900">
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
        className="mt-3 flex min-h-[56px] items-center justify-between rounded-2xl bg-gold-400 px-4 font-bold text-brand-900 shadow-sm hover:bg-gold-600"
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
