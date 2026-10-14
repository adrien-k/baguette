import { useEffect, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, X } from 'lucide-react';
import { agentsService, sessionsService } from '../feathers.js';
import { reviewerFromSession, reviewerCompletedTransition } from '../utils/sessionAgents.js';
import { requestNotificationPermission, showBrowserNotification } from '../utils/notifications.js';
import { useFilterRoutes } from './useFilterRoutes.js';

function isTabHidden() {
  return document.visibilityState === 'hidden';
}

/** Toasts and browser notifications when sessions complete, fail, or finish review. */
export function useSessionNotifications(sessions, loading) {
  const location = useLocation();
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
      prevReviewStatusRef.current.set(s.id, reviewerFromSession(s)?.status);
    });
  }, [sessions, loading]);

  const { sessionUrl } = useFilterRoutes();
  const sessionPath = useCallback((session) => sessionUrl(session.id), [sessionUrl]);

  const isCurrentSession = useCallback(
    (session) => locationRef.current.pathname === sessionPath(session),
    [sessionPath]
  );

  const issuesPath = useCallback((session) => `${sessionPath(session)}?view=review`, [sessionPath]);

  const notifyCompleted = useCallback(
    (session) => {
      const label = session.label || `Session #${session.id}`;
      if (!isCurrentSession(session)) {
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
      }

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
    [sessionPath, isCurrentSession]
  );

  const notifyReviewCompleted = useCallback(
    (session) => {
      const label = session.label || `Session #${session.id}`;
      if (!isCurrentSession(session)) {
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
      }

      if (isTabHidden()) {
        showBrowserNotification('Review completed', label, `review-completed-${session.id}`, () => {
          window.focus();
        });
      }
    },
    [issuesPath, isCurrentSession]
  );

  const notifyFailed = useCallback(
    (session) => {
      const label = session.label || `Session #${session.id}`;
      if (!isCurrentSession(session)) {
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
      }
      if (isTabHidden()) {
        showBrowserNotification('Session failed', label, `session-failed-${session.id}`, () => {
          window.focus();
        });
      }
    },
    [sessionPath, isCurrentSession]
  );

  useEffect(() => {
    const onPatched = (session) => {
      const prev = prevStatusRef.current.get(session.id);
      if (prev !== undefined && prev !== session.status) {
        if (session.status === 'completed') notifyCompleted(session);
        if (session.status === 'failed') notifyFailed(session);
      }
      prevStatusRef.current.set(session.id, session.status);

      const nextReviewStatus = reviewerFromSession(session)?.status;
      const prevReview = prevReviewStatusRef.current.get(session.id);
      if (reviewerCompletedTransition(prevReview, nextReviewStatus)) {
        notifyReviewCompleted(session);
      }
      prevReviewStatusRef.current.set(session.id, nextReviewStatus);
    };

    const onAgentPatched = (agent) => {
      if (!agent?.session_id || agent.agent_type !== 'reviewer') return;
      const prevReview = prevReviewStatusRef.current.get(agent.session_id);
      if (reviewerCompletedTransition(prevReview, agent.status)) {
        const session = sessionsRef.current.find((s) => s.id === agent.session_id);
        if (session) notifyReviewCompleted(session);
      }
      prevReviewStatusRef.current.set(agent.session_id, agent.status);
    };

    sessionsService.on('patched', onPatched);
    agentsService.on('patched', onAgentPatched);
    return () => {
      sessionsService.off('patched', onPatched);
      agentsService.off('patched', onAgentPatched);
    };
  }, [notifyCompleted, notifyFailed, notifyReviewCompleted]);
}
