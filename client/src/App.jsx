import { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useSearchParams } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import { Settings as SettingsIcon, LogOut } from 'lucide-react';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Session from './pages/Session.jsx';
import Settings from './pages/Settings.jsx';
import Onboarding from './pages/Onboarding.jsx';
import RunningTasksDropdown from './components/RunningTasksDropdown.jsx';
import { SessionsProvider } from './context/SessionsContext.jsx';
import { RepoProvider, useRepoContext, ALL_REPOS } from './context/RepoContext.jsx';
import { FilterProvider } from './context/FilterContext.jsx';
import RepoPicker from './components/RepoPicker.jsx';

function Nav() {
  const { user, logout } = useAuth();
  const { selectedRepo, repos } = useRepoContext();
  const location = useLocation();
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

  const currentRepo =
    selectedRepo && selectedRepo !== ALL_REPOS
      ? repos?.find((r) => r.full_name === selectedRepo)
      : null;
  const logoLink = currentRepo ? `/repos/${currentRepo.id}` : '/';

  const menuItemClass =
    'flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-700/50 transition-colors';

  return (
    <nav className="bg-zinc-900 border-b border-zinc-800 relative z-40 shrink-0">
      <div className="px-4 flex items-center justify-between h-14">
        <div className="flex items-center shrink-0">
          <Link to={logoLink} className="flex items-center gap-2">
            <img src="/baguette.svg" alt="" className="w-6 h-6 shrink-0" />
            <span className="text-white font-semibold text-sm font-display">Baguette</span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <RepoPicker />
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
              <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg py-1 z-50">
                <div className="px-4 pt-2 pb-2 border-b border-zinc-700 mb-1">
                  <div className="text-zinc-500 text-sm">{user.username}</div>
                </div>
                <div>
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

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" />;
  if (!user.approved) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="bg-zinc-900 rounded-xl p-8 text-center max-w-md">
          <h2 className="text-xl font-semibold text-white mb-2">Account Pending</h2>
          <p className="text-zinc-400">
            Your account is awaiting admin approval. Please check back later.
          </p>
        </div>
      </div>
    );
  }
  if (!user.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" />;
  }

  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

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
          <Route path="/admin" element={<AdminRedirect />} />
          <Route path="/admin/*" element={<AdminRedirect />} />
          <Route path="/account" element={<Navigate to="/settings" replace />} />
          <Route
            path="/onboarding"
            element={
              !user || !user.approved ? (
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

export default function App() {
  return (
    <AuthProvider>
      <FilterProvider>
        <SessionsProvider>
          <RepoProvider>
            <AppRoutes />
            <Toaster
              position="bottom-center"
              toastOptions={{ duration: 5000 }}
              containerStyle={{ bottom: '1.5rem' }}
            />
          </RepoProvider>
        </SessionsProvider>
      </FilterProvider>
    </AuthProvider>
  );
}
