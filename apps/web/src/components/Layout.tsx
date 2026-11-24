import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { hasAdminAccess } from '@siwu/shared';
import { useAuth, useMe } from '../auth/AuthProvider';
import { useFriendships } from '../lib/friends';
import { fetchTrendingTags, fetchUpcomingEvents } from '../lib/queries';
import { useChats } from '../pages/chat';
import { CountBadge, useUnreadNotifications } from '../pages/notifications';
import { LogoMark, Wordmark } from './Brand';
import { LiveBanner } from './LiveBanner';
import { CreateSheet, FeedbackDialog, InviteButton } from './extras';
import { Icon, type IconName } from './Icon';
import { ThemePicker } from './theme';
import { Avatar } from './ui';

/** Bottom bar on phones (icons, like X). Events, market and more live in the side menu. */
const tabs: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/explore', label: 'Explore', icon: 'search' },
  { to: '/sports', label: 'Sports', icon: 'trophy' },
  { to: '/notifications', label: 'Notifications', icon: 'bell' },
  { to: '/chat', label: 'Chat', icon: 'message' },
];

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

function useBadges() {
  const notifications = useUnreadNotifications();
  const { dms, isUnread } = useChats();
  const f = useFriendships();
  return { notifications, chat: (dms ?? []).filter(isUnread).length + f.incoming.length };
}

export function AppLayout() {
  const { profile, role } = useAuth();
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const [badges, setBadges] = useState<Badges>({ notifications: 0, chat: 0 });
  const wide = useMedia('(min-width: 640px)');
  const veryWide = useMedia('(min-width: 1024px)');
  useEffect(() => setDrawer(false), [location.pathname]);
  const inChat = /^\/chat\/./.test(location.pathname);
  const showFab = profile?.status === 'active' && !inChat && !/^\/(new|stories\/new|admin)/.test(location.pathname);

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex max-w-[1265px] justify-center">
        {/* Left column (tablets and computers) */}
        {profile && wide && <SideNav badges={badges} onCreate={() => setCreating(true)} onFeedback={() => setFeedback(true)} />}

        <div className="min-w-0 max-w-[600px] flex-1 border-sand-200 pb-28 sm:border-x sm:pb-8">
          {/* Top bar (phones) */}
          <header className="sticky top-0 z-30 border-b border-sand-200 bg-white/90 backdrop-blur sm:hidden">
            <div className="grid h-14 grid-cols-[72px_1fr_72px] items-center px-3">
              {profile ? (
                <button onClick={() => setDrawer(true)} aria-label="Open menu" className="rounded-full">
                  <Avatar url={profile.photoUrl} name={profile.displayName} size={34} />
                </button>
              ) : (
                <span />
              )}
              <Link to="/" aria-label="Siwu Connect home" className="justify-self-center">
                <LogoMark size={30} />
              </Link>
              <span className="flex items-center justify-self-end">
                {hasAdminAccess(role) && (
                  <NavLink to="/admin" aria-label="Admin area" className="mr-1 rounded-full p-1 text-gray-700 aria-[current=page]:text-brand-700">
                    <Icon name="shield" className="h-6 w-6" />
                  </NavLink>
                )}
                <button
                  onClick={() => setFeedback(true)}
                  className="rounded-full bg-gold-400 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#0d4a1e]"
                  title="This is an early test version — tap to send feedback"
                >
                  Beta
                </button>
              </span>
            </div>
          </header>

          {profile && <LiveBanner />}

          {profile?.status === 'suspended' && (
            <div className="px-4 pt-3">
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                Your account has been suspended by a moderator. You can still read posts, but you cannot post, comment,
                like or report. See the <Link to="/rules" className="underline">community rules</Link>.
              </div>
            </div>
          )}

          <main className="px-4 pt-3">
            <Outlet />
          </main>
        </div>

        {/* Right column (computers) */}
        {profile && veryWide && <RightRail />}
      </div>

      {profile && <BadgeSource onChange={setBadges} />}
      {/* Compose button */}
      {showFab && (
        <button
          onClick={() => setCreating(true)}
          aria-label="Create"
          className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-900/30 hover:bg-brand-700 sm:hidden"
        >
          <Icon name="plus" className="h-7 w-7" />
        </button>
      )}

      {/* Bottom bar (phones) */}
      {profile && !wide && <BottomNav badges={badges} />}

      {profile && drawer && !wide && <Drawer onClose={() => setDrawer(false)} onFeedback={() => setFeedback(true)} admin={hasAdminAccess(role)} />}
      {profile && <CreateSheet open={creating} onClose={() => setCreating(false)} />}
      {profile && <FeedbackDialog open={feedback} onClose={() => setFeedback(false)} />}
    </div>
  );
}

type Badges = ReturnType<typeof useBadges>;

/** Listens once for unread counts (hooks need a signed-in member, so this renders only then). */
function BadgeSource({ onChange }: { onChange: (b: Badges) => void }) {
  const b = useBadges();
  useEffect(() => onChange(b), [b.notifications, b.chat]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function BottomNav({ badges }: { badges: Badges }) {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-sand-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <ul className="grid grid-cols-5">
        {tabs.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={n.end}
              aria-label={(() => {
                const c = n.to === '/notifications' ? badges.notifications : n.to === '/chat' ? badges.chat : 0;
                return c ? `${n.label}, ${c} unread` : n.label;
              })()}
              className={({ isActive }) => `flex h-[56px] items-center justify-center ${isActive ? 'text-gray-900' : 'text-gray-500'}`}
            >
              {({ isActive }) => (
                <span className="relative">
                  <Icon name={n.icon} filled={isActive && n.icon !== 'search'} className={`h-[26px] w-[26px] ${isActive ? 'stroke-[2.4]' : ''}`} />
                  {n.to === '/notifications' && <CountBadge n={badges.notifications} />}
                  {n.to === '/chat' && <CountBadge n={badges.chat} />}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const moreLinks: { to: string; label: string; icon: IconName }[] = [
  { to: '/events', label: 'Events', icon: 'calendar' },
  { to: '/market', label: 'Marketplace', icon: 'cart' },
  { to: '/directory', label: 'Businesses & jobs', icon: 'globe' },
  { to: '/towns', label: 'Towns', icon: 'towns' },
];

function SideNav({ onCreate, onFeedback, badges }: { onCreate: () => void; onFeedback: () => void; badges: Badges }) {
  const { profile, role } = useMe();
  const items: { to: string; label: string; icon: IconName; end?: boolean; badge?: number; aria?: string }[] = [
    ...tabs.map((t) => ({ ...t, badge: t.to === '/notifications' ? badges.notifications : t.to === '/chat' ? badges.chat : 0 })),
    ...moreLinks,
    { to: '/me', label: 'Profile', icon: 'user' },
    ...(hasAdminAccess(role) ? [{ to: '/admin', label: 'Admin', icon: 'shield' as const, aria: 'Admin area' }] : []),
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ];
  return (
    <header className="sticky top-0 hidden h-screen w-[76px] shrink-0 flex-col items-end px-2 py-2 sm:flex xl:w-[260px] xl:items-stretch">
      <Link to="/" aria-label="Siwu Connect home" className="mb-2 flex h-12 items-center justify-center rounded-full px-2 hover:bg-sand-100 xl:justify-start">
        <span className="xl:hidden">
          <LogoMark size={32} />
        </span>
        <span className="hidden xl:block">
          <Wordmark />
        </span>
      </Link>
      <nav aria-label="Main" className="flex-1 overflow-y-auto">
        <ul className="space-y-0.5">
          {items.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.end}
                title={n.label}
                aria-label={n.badge ? `${n.label}, ${n.badge} unread` : (n.aria ?? n.label)}
                className={({ isActive }) =>
                  `flex h-12 items-center justify-center gap-4 rounded-full px-3 text-xl hover:bg-sand-100 xl:justify-start ${isActive ? 'font-bold text-gray-900' : 'text-gray-800'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <Icon name={n.icon} filled={isActive && n.icon !== 'search'} className="h-[26px] w-[26px]" />
                      <CountBadge n={n.badge ?? 0} />
                    </span>
                    <span className="hidden xl:inline">{n.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <button
          onClick={onCreate}
          disabled={profile.status !== 'active'}
          className="mt-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white shadow hover:bg-brand-700 disabled:opacity-50 xl:w-full"
          aria-label="Create"
        >
          <Icon name="plus" className="h-6 w-6 xl:hidden" />
          <span className="hidden xl:inline">Post</span>
        </button>
      </nav>
      <button onClick={onFeedback} className="mb-2 self-center rounded-full bg-gold-400 px-2 py-0.5 text-[11px] font-black uppercase text-[#0d4a1e] xl:self-start">
        Beta · feedback
      </button>
      <Link to="/me" className="flex items-center gap-3 rounded-full p-2 hover:bg-sand-100">
        <Avatar url={profile.photoUrl} name={profile.displayName} size={40} />
        <span className="hidden min-w-0 xl:block">
          <span className="block truncate font-bold text-gray-900">{profile.displayName}</span>
          <span className="block truncate text-sm text-gray-600">@{profile.username}</span>
        </span>
      </Link>
    </header>
  );
}

function Drawer({ onClose, onFeedback, admin }: { onClose: () => void; onFeedback: () => void; admin: boolean }) {
  const { profile, signOut } = useAuth();
  const f = useFriendships();
  const navigate = useNavigate();
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  if (!profile) return null;
  const links: { to: string; label: string; icon: IconName }[] = [
    { to: '/me', label: 'Profile', icon: 'user' },
    ...moreLinks,
    ...(admin ? [{ to: '/admin', label: 'Admin', icon: 'shield' as const }] : []),
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ];
  return (
    <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={onClose} />
      <aside className="absolute inset-y-0 left-0 flex w-[80%] max-w-xs flex-col overflow-y-auto bg-white px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-4 shadow-2xl">
        <Link to="/me" className="block">
          <Avatar url={profile.photoUrl} name={profile.displayName} size={44} />
          <span className="mt-2 block font-black text-gray-900">
            {profile.displayName} {profile.vibe}
          </span>
          <span className="block text-sm text-gray-600">@{profile.username}</span>
        </Link>
        <Link to="/chat" className="mt-2 text-sm text-gray-700">
          <strong className="text-gray-900">{f.friends.length}</strong> {f.friends.length === 1 ? 'friend' : 'friends'}
          {f.incoming.length > 0 && (
            <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{f.incoming.length} new request{f.incoming.length > 1 ? 's' : ''}</span>
          )}
        </Link>
        <nav className="mt-4 border-t border-sand-200 pt-2" aria-label="More">
          <ul>
            {links.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="flex h-12 items-center gap-4 text-lg font-bold text-gray-900">
                  <Icon name={l.icon} className="h-6 w-6" /> {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-3 space-y-3 border-t border-sand-200 pt-4">
          <ThemePicker />
          <InviteButton className="w-full" />
          <button
            onClick={() => {
              onClose();
              onFeedback();
            }}
            className="flex w-full items-center gap-3 text-sm font-semibold text-gray-800"
          >
            <Icon name="megaphone" className="h-5 w-5" /> Send feedback
          </button>
          <button
            onClick={async () => {
              await signOut();
              navigate('/welcome');
            }}
            className="flex w-full items-center gap-3 text-sm font-semibold text-red-700"
          >
            <Icon name="back" className="h-5 w-5" /> Sign out
          </button>
        </div>
      </aside>
    </div>
  );
}

/** Search, what's trending and what's coming up — on wide screens. */
function RightRail() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const trending = useQuery({ queryKey: ['trending', 'rail'], queryFn: fetchTrendingTags, staleTime: 5 * 60_000 });
  const events = useQuery({ queryKey: ['events', 'all'], queryFn: () => fetchUpcomingEvents(null), staleTime: 60_000 });
  return (
    <aside className="sticky top-0 hidden h-screen w-[350px] shrink-0 space-y-4 overflow-y-auto px-6 py-2 lg:block" aria-label="Sidebar">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <label className="flex h-11 items-center gap-3 rounded-full bg-sand-100 px-4 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500">
          <Icon name="search" className="h-5 w-5 text-gray-500" />
          <span className="sr-only">Search Siwu Connect</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-full bg-transparent outline-none" type="search" />
        </label>
      </form>
      <section className="overflow-hidden rounded-2xl border border-sand-200">
        <h2 className="px-4 pb-1 pt-3 text-xl font-black text-gray-900">What's happening</h2>
        {(trending.data ?? []).length === 0 ? (
          <p className="px-4 pb-4 text-sm text-gray-600">Use #hashtags in your posts to start a trend.</p>
        ) : (
          <ul>
            {trending.data!.slice(0, 6).map((t) => (
              <li key={t.tag}>
                <Link to={`/tag/${t.tag}`} className="block px-4 py-2.5 hover:bg-sand-100">
                  <span className="block text-xs text-gray-600">Trending in Akpafu</span>
                  <span className="block font-bold text-gray-900">#{t.tag}</span>
                  <span className="block text-xs text-gray-600">
                    {t.count} {t.count === 1 ? 'post' : 'posts'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {(events.data ?? []).length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-sand-200">
          <h2 className="px-4 pb-1 pt-3 text-xl font-black text-gray-900">Coming up</h2>
          <ul>
            {events.data!.slice(0, 4).map((e) => (
              <li key={e.id}>
                <Link to={`/events/${e.id}`} className="block px-4 py-2.5 hover:bg-sand-100">
                  <span className="block text-xs text-gray-600">{e.startsAt?.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <span className="block font-bold text-gray-900">{e.title}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/events" className="block px-4 py-3 text-sm text-brand-700 hover:bg-sand-100">
            Show more
          </Link>
        </section>
      )}
      <p className="px-2 text-xs text-gray-500">
        <Link to="/rules" className="hover:underline">Community rules</Link> · <Link to="/privacy" className="hover:underline">Privacy</Link> · Siwu Connect
      </p>
    </aside>
  );
}

/** Layout for signed-out pages (welcome, login, register, rules, privacy). */
export function PublicLayout() {
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex h-16 max-w-md items-center px-4">
        <Link to="/welcome" aria-label="Siwu Connect">
          <Wordmark />
        </Link>
      </header>
      <main className="mx-auto max-w-md px-4 pb-12 pt-2">
        <Outlet />
      </main>
    </div>
  );
}
