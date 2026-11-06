import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import {
  Settings as SettingsIcon,
  Shield,
  LogOut,
  ChartNoAxesCombined,
  CircleDollarSign,
  Monitor,
} from 'lucide-react';
import NavbarTasksAndStats from './components/NavbarTasksAndStats.jsx';
import Login from './pages/Login.jsx';
import Invite from './pages/Invite.jsx';
const System = lazy(() => import('./pages/System.jsx'));
const Session = lazy(() => import('./pages/Session.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Usage = lazy(() => import('./pages/Usage.jsx'));
const ModelPricing = lazy(() => import('./pages/ModelPricing.jsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'));
import { SessionsProvider } from './context/SessionsContext.jsx';
import { RepoProvider } from './context/RepoContext.jsx';
import { useFilterRoutes } from './hooks/useFilterRoutes.js';
import RepoPicker from './components/RepoPicker.jsx';
import GitHubBadCredentialsListener from './components/GitHubBadCredentialsListener.jsx';
import BaguetteIcon from './components/svg/BaguetteIcon.jsx';
import ColorSchemeToggle from './components/ColorSchemeToggle.jsx';
import UserAvatar from './components/UserAvatar.jsx';
import { ColorSchemeProvider } from './hooks/useColorScheme.jsx';
import { CurrentUserProvider } from './context/CurrentUserContext.jsx';
import { AgentConfigProvider } from './context/AgentConfigContext.jsx';
import { DROPDOWN_PANEL_CLASS } from './utils/dropdownPanel.js';
import { MENU_ITEM_ACCENT_CLASS, MENU_ITEM_CLASS, NAV_CLASS, PAGE_BG } from './utils/ui.js';
import { GHOST_BUTTON_CLASS } from './utils/buttonStyles.js';

function LoadingScreen() {
  return (
    <div className={`min-h-screen ${PAGE_BG} flex items-center justify-center`}>
      <div className="text-fg-muted">Loading...</div>
    </div>
  );
}

function AccountPendingScreen({ user, logout }) {
  return (
    <div
      className={`min-h-screen ${PAGE_BG} flex items-center justify-center relative overflow-hidden`}
    >
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[500px] bg-brand/[0.06] rounded-full blur-3xl" />
      </div>
      <div className="bg-nav rounded-2xl p-10 text-center max-w-sm w-full shadow-2xl border border-line relative">
        <BaguetteIcon className="w-16 h-16 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-fg mb-2 font-display">Account Pending</h1>
        <p className="text-fg-muted mb-8 text-sm">
          {user?.username ? (
            <>
              <span className="text-heading font-medium">{user.username}</span> is awaiting admin
              approval. Please check back later.
            </>
          ) : (
            'Your account is awaiting admin approval. Please check back later.'
          )}
        </p>
        <button
          type="button"
          onClick={logout}
          className={`${GHOST_BUTTON_CLASS} w-full inline-flex items-center justify-center gap-2`}
        >
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      </div>
    </div>
  );
}

function Nav() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { homeUrl } = useFilterRoutes();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    setUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userMenuOpen]);

  if (!user) return null;

  const onOnboarding = location.pathname === '/onboarding';

  return (
    <nav className={`${NAV_CLASS} relative z-40 shrink-0`}>
      <div className="px-4 flex xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3 h-14 min-w-0">
        <Link to={homeUrl} className="flex items-center gap-2 shrink-0 min-w-0">
          <BaguetteIcon className="w-6 h-6 shrink-0" />
          <span className="hidden sm:inline text-fg font-semibold text-sm font-display whitespace-nowrap">
            Baguette
          </span>
        </Link>
        <div className="flex flex-1 min-w-0 items-center justify-end gap-2 sm:gap-3 xl:contents">
          <div className="relative z-10 flex items-center min-w-0 max-w-full xl:justify-self-center xl:justify-center">
            <NavbarTasksAndStats />
          </div>
          <div className="relative z-0 flex min-w-0 items-center gap-2 sm:gap-3 shrink-0 xl:max-w-full xl:justify-self-end xl:justify-end">
            <div className="hidden sm:block shrink-0">
              <ColorSchemeToggle />
            </div>
            {onOnboarding ? null : <RepoPicker className="shrink" shrinkableTrigger />}
            {onOnboarding ? null : (
              <div className="relative flex items-center gap-2 sm:gap-3 shrink-0">
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-control/50 transition-colors"
                  >
                    <UserAvatar user={user} size="md" />
                    <span className="hidden sm:block text-secondary text-sm">{user.username}</span>
                  </button>
                  {userMenuOpen && (
                    <div
                      className={`absolute right-0 top-full mt-1 w-52 ${DROPDOWN_PANEL_CLASS} py-1 z-50`}
                    >
                      <div className="sm:hidden">
                        <ColorSchemeToggle menuItem />
                      </div>
                      <div className="border-t border-strong mt-1 pt-1 sm:border-t-0 sm:mt-0 sm:pt-0">
                        <Link to="/usage" className={MENU_ITEM_CLASS}>
                          <ChartNoAxesCombined className="w-4 h-4 text-faint" />
                          Usage
                        </Link>
                        <Link to="/model-pricing" className={MENU_ITEM_CLASS}>
                          <CircleDollarSign className="w-4 h-4 text-faint" />
                          Model pricing
                        </Link>
                        <Link to="/system" className={MENU_ITEM_CLASS}>
                          <Monitor className="w-4 h-4 text-faint" />
                          System
                        </Link>
                        <Link to="/settings" className={MENU_ITEM_CLASS}>
                          <SettingsIcon className="w-4 h-4 text-faint" />
                          Settings
                        </Link>
                      </div>
                      {user.admin ? (
                        <div className="border-t border-strong mt-1 pt-1">
                          <Link to="/admin" className={MENU_ITEM_ACCENT_CLASS}>
                            <Shield className="w-4 h-4" />
                            Admin
                          </Link>
                        </div>
                      ) : null}
                      <div className="border-t border-strong mt-1 pt-1">
                        <button onClick={logout} className={MENU_ITEM_CLASS}>
                          <LogOut className="w-4 h-4 text-faint" />
                          Sign out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  if (!user) return <Navigate to="/login" />;
  if (!user.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" />;
  }

  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <div className={`h-screen min-h-screen ${PAGE_BG} flex flex-col`}>
      <Nav />
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route
              path="/login"
              element={
                user ? (
                  <Navigate to="/" />
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto">
                    <Login />
                  </div>
                )
              }
            />
            <Route
              path="/invite/:token"
              element={
                user ? (
                  <Navigate to="/" />
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto">
                    <Invite />
                  </div>
                )
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/shared"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/shared/sessions/:id"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/shared/loops"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/shared/loops/:loopId"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/global"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/global/sessions/:id"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/loops"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/loops/:loopId"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/global/loops"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/global/loops/:loopId"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sessions/:id"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/repos/:repoId"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/repos/:repoId/loops"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/repos/:repoId/loops/:loopId"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/repos/:repoId/sessions/:id"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <Settings />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/usage"
              element={
                <ProtectedRoute>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <Usage />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/model-pricing"
              element={
                <ProtectedRoute>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <ModelPricing />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/system"
              element={
                <ProtectedRoute>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <System />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <Admin />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/*"
              element={
                <ProtectedRoute>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <Admin />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route path="/account" element={<Navigate to="/settings" replace />} />
            <Route
              path="/onboarding"
              element={
                !user ? (
                  <Navigate to="/login" />
                ) : user.onboarding_completed ? (
                  <Navigate to="/" />
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto">
                    <Onboarding />
                  </div>
                )
              }
            />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

function AppContent() {
  const { user, loading, logout } = useAuth();

  if (loading) return <LoadingScreen />;

  if (user && !user.approved) {
    return <AccountPendingScreen user={user} logout={logout} />;
  }

  const routes = <AppRoutes />;

  if (!user) {
    return routes;
  }

  return (
    <AgentConfigProvider>
      <RepoProvider>
        <SessionsProvider>
          <GitHubBadCredentialsListener />
          {routes}
        </SessionsProvider>
      </RepoProvider>
    </AgentConfigProvider>
  );
}

function ThemedToaster() {
  return (
    <Toaster
      position="bottom-left"
      containerStyle={{ bottom: '1.5rem', left: '1.5rem' }}
      toastOptions={{
        duration: 5000,
        style: {
          background: 'var(--palette-control)',
          color: 'var(--palette-fg)',
          border: '1px solid var(--palette-line-strong)',
        },
      }}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CurrentUserProvider>
        <ColorSchemeProvider>
          <AppContent />
          <ThemedToaster />
        </ColorSchemeProvider>
      </CurrentUserProvider>
    </AuthProvider>
  );
}
