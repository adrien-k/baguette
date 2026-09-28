import { createContext, useContext, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, X } from 'lucide-react';
import { useGetUserSessions } from '../hooks/useGetUserSessions.js';
import { sessionsService } from '../feathers.js';
import { requestNotificationPermission, showBrowserNotification } from '../utils/notifications.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import { useFilters } from './FilterContext.jsx';
import { useRepoContext } from './RepoContext.jsx';
import { sessionsListQueryFromPath } from '@baguette/shared/session-list-query.js';

const SessionsContext = createContext(null);

function isTabHidden() {
  return document.visibilityState === 'hidden';
}

export function SessionsProvider({ children }) {
  const location = useLocation();
  const { showArchived, showLoopRuns } = useFilters() ?? {};
  const { repos } = useRepoContext() ?? {};
  const listQuery = useMemo(
    () =>
      sessionsListQueryFromPath(location.pathname, {
        showArchived,
        showLoopRuns,
      }),
    [location.pathname, showArchived, showLoopRuns]
  );
  const { sessions, loading, refetch, hasMore, loadMore } = useGetUserSessions(listQuery, {
    repos,
  });
  const prevStatusRef = useRef(new Map());
  const prevReviewStatusRef = useRef(new Map());
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const initializedRef = useRef(false);
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
    sessions.forEach((s) => {
      prevStatusRef.current.set(s.id, s.status);
      prevReviewStatusRef.current.set(s.id, s.review_status);
    });
  }, [sessions, loading]);

  const { sessionUrl } = useFilterRoutes();
  const sessionPath = useCallback((session) => sessionUrl(session.short_id), [sessionUrl]);

  const isCurrentSession = useCallback(
    (session) => locationRef.current.pathname === sessionPath(session),
    [sessionPath]
  );

  const issuesPath = useCallback((session) => `${sessionPath(session)}?view=review`, [sessionPath]);

  const notifyCompleted = useCallback(
    (session) => {
      const label = session.label || `Session #${session.id}`;
      toast.custom(
        (t) => (
          <div
            className={`bg-control border border-strong rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg w-full max-w-sm transition-all ${t.visible ? 'opacity-100' : 'opacity-0'}`}
          >
            <CheckCircle className="w-5 h-5 text-success shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-fg text-sm font-medium truncate">{label}</p>
              <p className="text-fg-muted text-xs">Session completed</p>
            </div>
            <Link
              to={sessionPath(session)}
              onClick={() => toast.dismiss(t.id)}
              className="text-accent text-xs font-medium shrink-0 hover:text-accent"
            >
              View
            </Link>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="text-faint hover:text-secondary shrink-0"
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

  const notifyReviewCompleted = useCallback(
    (session) => {
      const label = session.label || `Session #${session.id}`;
      const issuesTo = issuesPath(session);
      toast.custom(
        (t) => (
          <div
            className={`bg-control border border-strong rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg w-full max-w-sm transition-all ${t.visible ? 'opacity-100' : 'opacity-0'}`}
          >
            <CheckCircle className="w-5 h-5 text-success shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-fg text-sm font-medium truncate">{label}</p>
              <p className="text-fg-muted text-xs">Review completed</p>
            </div>
            <Link
              to={issuesTo}
              onClick={() => toast.dismiss(t.id)}
              className="text-accent text-xs font-medium shrink-0 hover:text-accent"
            >
              Issues
            </Link>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="text-faint hover:text-secondary shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
        { duration: 8000 }
      );

      if (isTabHidden()) {
        showBrowserNotification('Review completed', label, `review-completed-${session.id}`, () => {
          window.focus();
        });
      }
    },
    [issuesPath]
  );

  const notifyFailed = useCallback(
    (session) => {
      if (isCurrentSession(session)) return;
      const label = session.label || `Session #${session.id}`;
      toast.custom(
        (t) => (
          <div
            className={`bg-control border border-strong rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg w-full max-w-sm transition-all ${t.visible ? 'opacity-100' : 'opacity-0'}`}
          >
            <XCircle className="w-5 h-5 text-danger shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-fg text-sm font-medium truncate">{label}</p>
              <p className="text-fg-muted text-xs">Session failed</p>
            </div>
            <Link
              to={sessionPath(session)}
              onClick={() => toast.dismiss(t.id)}
              className="text-accent text-xs font-medium shrink-0 hover:text-accent"
            >
              View
            </Link>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="text-faint hover:text-secondary shrink-0"
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
    [sessionPath, isCurrentSession]
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

      const prevReview = prevReviewStatusRef.current.get(session.id);
      if (prevReview !== undefined && prevReview !== session.review_status) {
        if (session.review_status === 'completed') notifyReviewCompleted(session);
      }
      prevReviewStatusRef.current.set(session.id, session.review_status);
    };
    sessionsService.on('patched', onPatched);
    return () => sessionsService.off('patched', onPatched);
  }, [notifyCompleted, notifyFailed, notifyReviewCompleted]);

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
