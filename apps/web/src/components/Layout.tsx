import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { CreateSheet, FeedbackDialog } from './extras';
import { NotificationBell } from '../pages/notifications';
import { ChatNavBadge } from '../pages/chat';
import { hasAdminAccess } from '@siwu/shared';
import { useAuth } from '../auth/AuthProvider';
import { Wordmark } from './Brand';
import { Icon, type IconName } from './Icon';
import { Avatar } from './ui';

const nav: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/sports', label: 'Sports', icon: 'trophy' },
  { to: '/new', label: 'Create', icon: 'plus' },
  { to: '/events', label: 'Events', icon: 'calendar' },
  { to: '/chat', label: 'Chat', icon: 'message' },
];

export function AppLayout() {
  const { profile, role } = useAuth();
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const location = useLocation();
  const inEvents = location.pathname.startsWith('/events') || location.pathname.startsWith('/market');
  return (
    <div className="min-h-screen bg-sand-100 pb-24">
      <header className="sticky top-0 z-30 border-b border-sand-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-2 px-3">
          <Link to="/" aria-label="Siwu Connect home" className="min-w-0">
            <Wordmark />
          </Link>
          <div className="flex items-center">
            <button
              onClick={() => setFeedback(true)}
              className="mr-0.5 rounded-full bg-gold-400 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#0d4a1e]"
              title="This is an early test version — tap to send feedback"
            >
              Beta
            </button>
            <NavLink
              to="/explore"
              className="rounded-full p-1.5 text-gray-700 hover:bg-sand-100 aria-[current=page]:text-brand-700"
              aria-label="Explore and search"
            >
              <Icon name="search" className="h-6 w-6" />
            </NavLink>
            {profile && <NotificationBell />}
            {hasAdminAccess(role) && (
              <NavLink
                to="/admin"
                className="rounded-full p-1.5 text-gray-700 hover:bg-sand-100 aria-[current=page]:text-brand-700"
                aria-label="Admin area"
                title="Admin area"
              >
                <Icon name="shield" className="h-6 w-6" />
              </NavLink>
            )}
            {profile && (
              <Link to="/me" aria-label="Your profile" className="ml-1 rounded-full ring-2 ring-brand-100">
                <Avatar url={profile.photoUrl} name={profile.displayName} size={32} />
              </Link>
            )}
          </div>
        </div>
      </header>

      {profile?.status === 'suspended' && (
        <div className="mx-auto max-w-2xl px-4 pt-3">
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Your account has been suspended by a moderator. You can still read posts, but you cannot post, comment, like
            or report. See the <Link to="/rules" className="underline">community rules</Link>.
          </div>
        </div>
      )}

      <main className="mx-auto max-w-2xl px-4 pt-3">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-sand-200 bg-white pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-5">
          {nav.map((n) => (
            <li key={n.to} className="flex justify-center">
              {n.icon === 'plus' ? (
                <button
                  onClick={() => setCreating(true)}
                  aria-label="Create"
                  className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white hover:bg-brand-700"
                >
                  <Icon name="plus" className="h-7 w-7" />
                </button>
              ) : (
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    `flex min-h-[58px] w-full flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                      isActive || (n.to === '/events' && inEvents) ? 'text-brand-600' : 'text-gray-600 hover:text-gray-900'
                    }`
                  }
                >
                  <span className="relative">
                    <Icon name={n.icon} className="h-6 w-6" />
                    {n.to === '/chat' && profile && <ChatNavBadge />}
                  </span>
                  {n.label}
                </NavLink>
              )}
            </li>
          ))}
        </ul>
      </nav>
      {profile && <CreateSheet open={creating} onClose={() => setCreating(false)} />}
      {profile && <FeedbackDialog open={feedback} onClose={() => setFeedback(false)} />}
    </div>
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
