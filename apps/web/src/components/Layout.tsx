import { Link, NavLink, Outlet } from 'react-router-dom';
import { hasAdminAccess } from '@siwu/shared';
import { useAuth } from '../auth/AuthProvider';
import { Icon, type IconName } from './Icon';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-extrabold tracking-tight text-brand-900">
      <img src="/favicon.svg" alt="" width={28} height={28} />
      <span>Siwu Connect</span>
    </Link>
  );
}

const nav: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/towns', label: 'Towns', icon: 'towns' },
  { to: '/new', label: 'Create', icon: 'plus' },
  { to: '/me', label: 'Profile', icon: 'user' },
];

export function AppLayout() {
  const { profile, role } = useAuth();
  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-30 border-b border-sand-200 bg-sand-100/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Logo />
          <div className="flex items-center gap-1">
            {hasAdminAccess(role) && (
              <NavLink
                to="/admin"
                className="rounded-lg p-2 text-gray-700 hover:bg-sand-200/60 aria-[current=page]:text-brand-800"
                aria-label="Admin area"
                title="Admin area"
              >
                <Icon name="shield" />
              </NavLink>
            )}
            <NavLink
              to="/search"
              className="rounded-lg p-2 text-gray-700 hover:bg-sand-200/60 aria-[current=page]:text-brand-800"
              aria-label="Search"
              title="Search"
            >
              <Icon name="search" />
            </NavLink>
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

      <main className="mx-auto max-w-2xl px-4 pt-4">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-sand-200 bg-white pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-4">
          {nav.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                    isActive ? 'text-brand-800' : 'text-gray-600 hover:text-gray-900'
                  }`
                }
              >
                {n.icon === 'plus' ? (
                  <span className="-my-1 rounded-full bg-brand-800 p-1 text-white">
                    <Icon name="plus" className="h-5 w-5" />
                  </span>
                ) : (
                  <Icon name={n.icon} />
                )}
                {n.label}
              </NavLink>
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
    <div className="min-h-screen">
      <header className="mx-auto flex h-14 max-w-2xl items-center px-4">
        <Logo />
      </header>
      <main className="mx-auto max-w-md px-4 pb-12 pt-4">
        <Outlet />
      </main>
    </div>
  );
}
