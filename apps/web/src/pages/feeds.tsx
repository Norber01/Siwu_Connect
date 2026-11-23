import { Link, useParams, useSearchParams } from 'react-router-dom';
import { TOWNS, isTownId, townName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { Announcements, CreatePostPrompt, Feed } from '../components/Feed';
import { Icon } from '../components/Icon';
import { EmptyState, PageHeader } from '../components/ui';

export function HomePage() {
  const { profile } = useMe();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'akpafu' ? 'akpafu' : 'town';
  const town = profile.hometownId;

  const tab = (id: 'town' | 'akpafu', label: string) => (
    <button
      role="tab"
      aria-selected={view === id}
      onClick={() => setParams(id === 'town' ? {} : { view: 'akpafu' }, { replace: true })}
      className={`min-h-[44px] flex-1 rounded-lg px-3 text-sm font-semibold ${
        view === id ? 'bg-white text-brand-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Choose feed" className="flex gap-1 rounded-xl bg-sand-200 p-1">
        {tab('town', townName(town))}
        {tab('akpafu', 'All Akpafu')}
      </div>
      <CreatePostPrompt townId={view === 'town' ? town : undefined} />
      <Announcements townId={view === 'town' ? town : null} />
      {view === 'town' ? (
        <Feed
          feed={{ kind: 'town', townId: town }}
          emptyTitle={`No posts in ${townName(town)} yet`}
          emptyText="Be the first to share news or ask a question."
        />
      ) : (
        <Feed
          feed={{ kind: 'akpafu' }}
          emptyTitle="No posts yet"
          emptyText="Public posts from all four towns will appear here."
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
      <ul className="space-y-2">
        {TOWNS.map((t) => (
          <li key={t.id}>
            <Link
              to={`/towns/${t.id}`}
              className="flex min-h-[64px] items-center justify-between rounded-2xl border border-sand-200 bg-white px-4 hover:border-brand-300"
            >
              <span>
                <span className="block font-semibold text-gray-900">{t.name}</span>
                {profile.hometownId === t.id && <span className="text-xs font-medium text-brand-700">Your hometown</span>}
              </span>
              <Icon name="back" className="h-5 w-5 rotate-180 text-gray-400" />
            </Link>
          </li>
        ))}
        <li>
          <Link
            to="/?view=akpafu"
            className="flex min-h-[64px] items-center justify-between rounded-2xl border border-brand-200 bg-brand-50 px-4 hover:border-brand-300"
          >
            <span className="flex items-center gap-2 font-semibold text-brand-900">
              <Icon name="globe" /> All Akpafu
            </span>
            <Icon name="back" className="h-5 w-5 rotate-180 text-gray-400" />
          </Link>
        </li>
      </ul>
    </div>
  );
}

export function TownPage() {
  const { townId = '' } = useParams();
  if (!isTownId(townId)) {
    return <EmptyState title="Town not found" icon="towns">Choose one of the four towns from the Towns page.</EmptyState>;
  }
  return (
    <div className="space-y-4">
      <PageHeader title={townName(townId)} back />
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
