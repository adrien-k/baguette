import { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usersService } from '../feathers.js';
import { currentUserKeys } from '../queries/keys.js';
import { feathersGet } from '../queries/feathersFinders.js';
import { useAuth } from '../hooks/useAuth.jsx';

const CurrentUserContext = createContext(null);

/** Full Feathers user record for the signed-in account (settings, API keys, prefs). */
export function CurrentUserProvider({ children }) {
  const { user: authUser } = useAuth();
  const authUserId = authUser?.id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: currentUserKeys.detail(authUserId),
    queryFn: () => feathersGet(usersService, authUserId),
    enabled: authUserId != null,
  });

  const { refetch: refetchQuery } = query;

  const refetch = useCallback(
    (opts) => {
      if (authUserId == null) return;
      // `silent` callers only wanted no loading spinner; React Query refetch
      // keeps showing existing data either way.
      void opts;
      return refetchQuery().then(() => undefined);
    },
    [authUserId, refetchQuery]
  );

  const updateCurrentUser = useCallback(
    (record) => {
      if (authUserId == null || record?.id == null) return;
      if (String(record.id) !== String(authUserId)) return;
      queryClient.setQueryData(currentUserKeys.detail(authUserId), record);
    },
    [authUserId, queryClient]
  );

  const value = useMemo(
    () => ({
      currentUser: authUserId != null ? (query.data ?? null) : null,
      loading: authUserId != null && query.isPending,
      error: query.error ?? null,
      refetch,
      updateCurrentUser,
    }),
    [authUserId, query.data, query.isPending, query.error, refetch, updateCurrentUser]
  );

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser() {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) {
    throw new Error('useCurrentUser must be used within CurrentUserProvider');
  }
  return ctx;
}
