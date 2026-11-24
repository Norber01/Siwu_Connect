import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AppLayout, PublicLayout } from './components/Layout';
import { PageSpinner } from './components/ui';
import { ForgotPasswordPage, LoginPage, RegisterPage, WelcomePage } from './pages/auth';
import { HomePage, TownPage, TownsPage } from './pages/feeds';
import { OnboardingPage } from './pages/Onboarding';
import { MyProfileRedirect, ProfilePage, SearchPage, SettingsPage } from './pages/people';
import { EditPostPage, NewPostPage, NotFoundPage, PostDetailPage } from './pages/posts';
import { PrivacyPage, RulesPage } from './pages/static';
import { SetupPage } from './pages/Setup';
import { EventDetailPage, EventFormPage, EventsPage } from './pages/events';
import { ListingDetailPage, ListingFormPage, MarketPage } from './pages/market';
import { MatchDetailPage, MatchFormPage, SportsPage } from './pages/sports';
import { NotificationsPage } from './pages/notifications';
import { ChatListPage, ChatRoomPage } from './pages/chat';

const AdminPage = lazy(() => import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })));

function FullScreenSpinner() {
  // If loading takes unusually long (e.g. a brand-new site whose security rules are not
  // installed yet), offer the way forward instead of an endless spinner.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <PageSpinner />
      {slow && (
        <p className="max-w-sm text-sm text-gray-600">
          This is taking longer than usual. Check your internet connection.{' '}
          <Link to="/setup" className="font-semibold text-brand-700 underline">
            Setting up Siwu Connect for the first time? Open the setup page.
          </Link>
        </p>
      )}
    </div>
  );
}

/** Signed in and onboarded. */
function RequireMember() {
  const { user, profile } = useAuth();
  const location = useLocation();
  if (user === undefined || (user && profile === undefined)) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/welcome" replace state={{ from: location.pathname }} />;
  if (!profile) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Signed in but has not created a profile yet. */
function RequireOnboarding() {
  const { user, profile } = useAuth();
  if (user === undefined || (user && profile === undefined)) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/welcome" replace />;
  if (profile) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Signed in (with or without a profile). */
function RequireSignedIn() {
  const { user } = useAuth();
  if (user === undefined) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Only for signed-out visitors. */
function RequireGuest() {
  const { user, profile } = useAuth();
  if (user === undefined) return <FullScreenSpinner />;
  if (user) return <Navigate to={profile === null ? '/onboarding' : '/'} replace />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route element={<RequireGuest />}>
        <Route path="/welcome" element={<WelcomePage />} />
      </Route>
      <Route element={<PublicLayout />}>
        <Route element={<RequireGuest />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        </Route>
        <Route element={<RequireOnboarding />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
        </Route>
        <Route element={<RequireSignedIn />}>
          <Route path="/setup" element={<SetupPage />} />
        </Route>
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
      </Route>
      <Route element={<RequireMember />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/towns" element={<TownsPage />} />
          <Route path="/towns/:townId" element={<TownPage />} />
          <Route path="/new" element={<NewPostPage />} />
          <Route path="/p/:postId" element={<PostDetailPage />} />
          <Route path="/p/:postId/edit" element={<EditPostPage />} />
          <Route path="/u/:username" element={<ProfilePage />} />
          <Route path="/me" element={<MyProfileRedirect />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/chat" element={<ChatListPage />} />
          <Route path="/chat/:chatId" element={<ChatRoomPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/new" element={<EventFormPage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/events/:eventId/edit" element={<EventFormPage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/market/new" element={<ListingFormPage />} />
          <Route path="/market/:listingId" element={<ListingDetailPage />} />
          <Route path="/market/:listingId/edit" element={<ListingFormPage />} />
          <Route path="/sports" element={<SportsPage />} />
          <Route path="/sports/new" element={<MatchFormPage />} />
          <Route path="/sports/:matchId" element={<MatchDetailPage />} />
          <Route path="/admin/*" element={<Suspense fallback={<PageSpinner />}><AdminPage /></Suspense>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
