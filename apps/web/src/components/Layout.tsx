import { Link, NavLink, Outlet } from 'react-router-dom';
import { hasAdminAccess } from '@siwu/shared';
import { useAuth } from '../auth/AuthProvider';
import { Wordmark } from './Brand';
import { Icon, type IconName } from './Icon';
import { Avatar } from './ui';

const nav: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/towns', label: 'Towns', icon: 'towns' },
  { to: '/new', label: 'Create', icon: 'plus' },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/me', label: 'Profile', icon: 'user' },
];

export function AppLayout() {
  const { profile, role } = useAuth();
  return (
    <div className="min-h-screen bg-sand-100 pb-24">
      <header className="sticky top-0 z-30 border-b border-sand-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Link to="/" aria-label="Siwu Connect home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1">
            {hasAdminAccess(role) && (
              <NavLink
                to="/admin"
                className="rounded-full p-2 text-gray-700 hover:bg-sand-100 aria-[current=page]:text-brand-700"
                aria-label="Admin area"
                title="Admin area"
              >
                <Icon name="shield" className="h-6 w-6" />
              </NavLink>
            )}
            {profile && (
              <Link to="/me" aria-label="Your profile" className="ml-1 rounded-full ring-2 ring-brand-100">
                <Avatar url={profile.photoUrl} name={profile.displayName} size={34} />
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
                <NavLink
                  to={n.to}
                  aria-label="Create post"
                  className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white hover:bg-brand-700"
                >
                  <Icon name="plus" className="h-7 w-7" />
                </NavLink>
              ) : (
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    `flex min-h-[58px] w-full flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                      isActive ? 'text-brand-600' : 'text-gray-600 hover:text-gray-900'
                    }`
                  }
                >
                  <Icon name={n.icon} className="h-6 w-6" />
                  {n.label}
                </NavLink>
              )}
            </li>
          ))}
        </ul>
      </nav>
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
