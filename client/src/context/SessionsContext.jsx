import { createContext, useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useGetUserSessions } from '../hooks/useGetUserSessions.js';
import { requestNotificationPermission } from '../utils/notifications.js';
import { useSessionNotifications } from '../hooks/useSessionNotifications.jsx';
import { useRepoContext } from './RepoContext.jsx';
import { useCurrentUser } from './CurrentUserContext.jsx';
import { sessionsListQueryFromPath } from '@baguette/shared/session-list-query.js';
import { normalizeListScope } from '@baguette/shared/session-sharing.js';

const SessionsContext = createContext(null);

export function SessionsProvider({ children }) {
  const location = useLocation();
  const { repos } = useRepoContext() ?? {};
  const { currentUser } = useCurrentUser();
  const listQuery = useMemo(
    () => sessionsListQueryFromPath(location.pathname),
    [location.pathname]
  );
  const listScope = normalizeListScope(listQuery.list_scope);
  const { sessions, loading, refetch, hasMore, loadMore } = useGetUserSessions(listQuery, {
    repos,
    currentUserId: currentUser?.id,
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
        listScope,
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
