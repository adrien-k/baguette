import { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useSearchParams } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import { Settings as SettingsIcon, LogOut, ChartNoAxesCombined } from 'lucide-react';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Session from './pages/Session.jsx';
import Settings from './pages/Settings.jsx';
import Usage from './pages/Usage.jsx';
import Onboarding from './pages/Onboarding.jsx';
import RunningTasksDropdown from './components/RunningTasksDropdown.jsx';
import { SessionsProvider } from './context/SessionsContext.jsx';
import { RepoProvider } from './context/RepoContext.jsx';
import { useFilterRoutes } from './hooks/useFilterRoutes.js';
import { FilterProvider } from './context/FilterContext.jsx';
import RepoPicker from './components/RepoPicker.jsx';
import GitHubBadCredentialsListener from './components/GitHubBadCredentialsListener.jsx';
import BaguetteIcon from './components/svg/BaguetteIcon.jsx';
import ColorSchemeToggle from './components/ColorSchemeToggle.jsx';
import { ColorSchemeProvider, useColorScheme } from './hooks/useColorScheme.jsx';
import { DROPDOWN_PANEL_CLASS } from './utils/dropdownPanel.js';

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-zinc-400">Loading...</div>
    </div>
  );
}

function AccountPendingScreen({ user, logout }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="bg-zinc-900 rounded-xl p-8 text-center max-w-md">
        <img src={user.avatar_url} alt="" className="w-14 h-14 rounded-full mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Account Pending</h2>
        <p className="text-zinc-400 mb-6">
          Your account is awaiting admin approval. Please check back later.
        </p>
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
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

  const menuItemClass =
    'flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-700/50 transition-colors';

  return (
    <nav className="bg-zinc-900 border-b border-zinc-800 relative z-40 shrink-0">
      <div className="px-4 flex items-center gap-2 sm:gap-3 h-14 min-w-0">
        <Link to={homeUrl} className="flex items-center gap-2 shrink-0">
          <BaguetteIcon className="w-6 h-6 shrink-0" />
          <span className="text-white font-semibold text-sm font-display whitespace-nowrap">
            Baguette
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 justify-end">
          <div className="hidden sm:block shrink-0">
            <ColorSchemeToggle />
          </div>
          <RepoPicker className="shrink" shrinkableTrigger />
          <div className="relative z-10 flex items-center gap-2 sm:gap-3 shrink-0">
            <RunningTasksDropdown />
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-zinc-800/50 transition-colors"
              >
                <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                <span className="hidden sm:block text-zinc-300 text-sm">{user.username}</span>
              </button>
              {userMenuOpen && (
                <div
                  className={`absolute right-0 top-full mt-1 w-48 ${DROPDOWN_PANEL_CLASS} py-1 z-50`}
                >
                  <div className="sm:hidden">
                    <ColorSchemeToggle menuItem />
                  </div>
                  <div className="border-t border-zinc-700 mt-1 pt-1 sm:border-t-0 sm:mt-0 sm:pt-0">
                    <Link to="/usage" className={menuItemClass}>
                      <ChartNoAxesCombined className="w-4 h-4 text-zinc-500" />
                      Usage
                    </Link>
                    <Link to="/settings" className={menuItemClass}>
                      <SettingsIcon className="w-4 h-4 text-zinc-500" />
                      Settings
                    </Link>
                  </div>
                  <div className="border-t border-zinc-700 mt-1 pt-1">
                    <button onClick={logout} className={menuItemClass}>
                      <LogOut className="w-4 h-4 text-zinc-500" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

function AdminRedirect() {
  const [searchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'secrets';
  const tab = rawTab === 'slack' ? 'integrations' : rawTab;
  return <Navigate to={`/settings?tab=${tab}`} replace />;
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
    <div className="h-screen min-h-screen bg-zinc-950 flex flex-col">
      <Nav />
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
            path="/"
            element={
              <ProtectedRoute>
                <div className="flex-1 min-h-0 overflow-auto">
                  <Dashboard />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/global"
            element={
              <ProtectedRoute>
                <div className="flex-1 min-h-0 overflow-auto">
                  <Dashboard />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/global/sessions/:short_id"
            element={
              <ProtectedRoute>
                <Session />
              </ProtectedRoute>
            }
          />
          <Route
            path="/global/loop/:loopId"
            element={
              <ProtectedRoute>
                <div className="flex-1 min-h-0 overflow-auto">
                  <Dashboard />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/loop/:loopId"
            element={
              <ProtectedRoute>
                <div className="flex-1 min-h-0 overflow-auto">
                  <Dashboard />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/sessions/:short_id"
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
                <div className="flex-1 min-h-0 overflow-auto">
                  <Dashboard />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:repoId/loop/:loopId"
            element={
              <ProtectedRoute>
                <div className="flex-1 min-h-0 overflow-auto">
                  <Dashboard />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:repoId/sessions/:short_id"
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
          <Route path="/admin" element={<AdminRedirect />} />
          <Route path="/admin/*" element={<AdminRedirect />} />
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
    <FilterProvider>
      <RepoProvider>
        <SessionsProvider>
          <GitHubBadCredentialsListener />
          {routes}
        </SessionsProvider>
      </RepoProvider>
    </FilterProvider>
  );
}

function ThemedToaster() {
  const { colorScheme } = useColorScheme();
  const isLight = colorScheme === 'light';

  return (
    <Toaster
      position="bottom-left"
      containerStyle={{ bottom: '1.5rem', left: '1.5rem' }}
      toastOptions={{
        duration: 5000,
        style: isLight
          ? {
              background: '#f4f4f5',
              color: '#18181b',
              border: '1px solid #d4d4d8',
            }
          : {
              background: '#27272a',
              color: '#fafafa',
              border: '1px solid #3f3f46',
            },
      }}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ColorSchemeProvider>
        <AppContent />
        <ThemedToaster />
      </ColorSchemeProvider>
    </AuthProvider>
  );
}
