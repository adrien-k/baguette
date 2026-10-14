import { createContext, useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useGetUserSessions } from '../hooks/useGetUserSessions.js';
import { requestNotificationPermission } from '../utils/notifications.js';
import { useSessionNotifications } from '../hooks/useSessionNotifications.jsx';
import { useFilters } from './FilterContext.jsx';
import { useRepoContext } from './RepoContext.jsx';
import { sessionsListQueryFromPath } from '@baguette/shared/session-list-query.js';

const SessionsContext = createContext(null);

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

  useSessionNotifications(sessions, loading);

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
