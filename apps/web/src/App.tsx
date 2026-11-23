import { Suspense, lazy } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AppLayout, PublicLayout } from './components/Layout';
import { PageSpinner } from './components/ui';
import { ForgotPasswordPage, LoginPage, RegisterPage, WelcomePage } from './pages/auth';
import { HomePage, TownPage, TownsPage } from './pages/feeds';
import { OnboardingPage } from './pages/Onboarding';
import { MyProfileRedirect, ProfilePage, SearchPage, SettingsPage } from './pages/people';
import { EditPostPage, NewPostPage, NotFoundPage, PostDetailPage } from './pages/posts';
import { PrivacyPage, RulesPage } from './pages/static';
import { EventDetailPage, EventFormPage, EventsPage } from './pages/events';
import { ListingDetailPage, ListingFormPage, MarketPage } from './pages/market';
import { MatchDetailPage, MatchFormPage, SportsPage } from './pages/sports';
import { NotificationsPage } from './pages/notifications';

const AdminPage = lazy(() => import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })));

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <PageSpinner />
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
