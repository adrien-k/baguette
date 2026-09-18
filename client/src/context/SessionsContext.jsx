import { createContext, useContext, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, X } from 'lucide-react';
import { useGetUserSessions } from '../hooks/useGetUserSessions.js';
import { sessionsService } from '../feathers.js';
import { requestNotificationPermission, showBrowserNotification } from '../utils/notifications.js';

const SessionsContext = createContext(null);

function isTabHidden() {
  return document.visibilityState === 'hidden';
}

export function SessionsProvider({ children }) {
  const { sessions, loading, refetch, hasMore, loadMore } = useGetUserSessions();
  const prevStatusRef = useRef(new Map());
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const initializedRef = useRef(false);
  const location = useLocation();
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Seed prevStatusRef once sessions load (avoid false positives on hydration)
  useEffect(() => {
    if (loading || initializedRef.current) return;
    initializedRef.current = true;
    sessions.forEach((s) => prevStatusRef.current.set(s.id, s.status));
  }, [sessions, loading]);

  const sessionPath = useCallback(
    (session) => `/repos/${session.repo_id}/sessions/${session.short_id}`,
    []
  );

  const isCurrentSession = useCallback(
    (session) => locationRef.current.pathname === sessionPath(session),
    [sessionPath]
  );

  const notifyCompleted = useCallback(
    (session) => {
      if (isCurrentSession(session)) return;
      const label = session.label || `Session #${session.id}`;
      toast.custom(
        (t) => (
          <div
            className={`bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg w-full max-w-sm transition-all ${t.visible ? 'opacity-100' : 'opacity-0'}`}
          >
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{label}</p>
              <p className="text-zinc-400 text-xs">Session completed</p>
            </div>
            <Link
              to={sessionPath(session)}
              onClick={() => toast.dismiss(t.id)}
              className="text-amber-400 text-xs font-medium shrink-0 hover:text-amber-300"
            >
              View
            </Link>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="text-zinc-500 hover:text-zinc-300 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
        { duration: 8000 }
      );

      if (isTabHidden()) {
        showBrowserNotification(
          'Session completed',
          label,
          `session-completed-${session.id}`,
          () => {
            window.focus();
          }
        );
      }
    },
    [sessionPath]
  );

  const notifyFailed = useCallback(
    (session) => {
      if (isCurrentSession(session)) return;
      const label = session.label || `Session #${session.id}`;
      toast.custom(
        (t) => (
          <div
            className={`bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg w-full max-w-sm transition-all ${t.visible ? 'opacity-100' : 'opacity-0'}`}
          >
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{label}</p>
              <p className="text-zinc-400 text-xs">Session failed</p>
            </div>
            <Link
              to={sessionPath(session)}
              onClick={() => toast.dismiss(t.id)}
              className="text-amber-400 text-xs font-medium shrink-0 hover:text-amber-300"
            >
              View
            </Link>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="text-zinc-500 hover:text-zinc-300 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
        { duration: 8000 }
      );
      if (isTabHidden()) {
        showBrowserNotification('Session failed', label, `session-failed-${session.id}`, () => {
          window.focus();
        });
      }
    },
    [sessionPath]
  );

  // Listen for status transitions
  useEffect(() => {
    const onPatched = (session) => {
      const prev = prevStatusRef.current.get(session.id);
      if (prev !== undefined && prev !== session.status) {
        if (session.status === 'completed') notifyCompleted(session);
        if (session.status === 'failed') notifyFailed(session);
      }
      prevStatusRef.current.set(session.id, session.status);
    };
    sessionsService.on('patched', onPatched);
    return () => sessionsService.off('patched', onPatched);
  }, [notifyCompleted, notifyFailed]);

  return (
    <SessionsContext.Provider
      value={{
        sessions,
        refetch,
        loading,
        hasMore,
        loadMore,
        requestNotificationPermission,
      }}
    >
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessionsContext() {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error('useSessionsContext must be used within SessionsProvider');
  return ctx;
}
