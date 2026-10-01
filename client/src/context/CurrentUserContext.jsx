import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usersService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { subscribeSseReconnect } from '../utils/sseReconnect.js';

const CurrentUserContext = createContext(null);

/** Full Feathers user record for the signed-in account (settings, API keys, prefs). */
export function CurrentUserProvider({ children }) {
  const { user: authUser } = useAuth();
  const authUserId = authUser?.id;
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchIdRef = useRef(0);

  const refetch = useCallback(() => {
    if (authUserId == null) return;
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    usersService
      .get(authUserId)
      .then((record) => {
        if (fetchId !== fetchIdRef.current) return;
        setCurrentUser(record);
        setError(null);
      })
      .catch((err) => {
        if (fetchId !== fetchIdRef.current) return;
        setCurrentUser(null);
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (fetchId === fetchIdRef.current) setLoading(false);
      });
  }, [authUserId]);

  const updateCurrentUser = useCallback(
    (record) => {
      if (authUserId == null || record?.id == null) return;
      if (String(record.id) !== String(authUserId)) return;
      setCurrentUser(record);
      setError(null);
      setLoading(false);
    },
    [authUserId]
  );

  useEffect(() => {
    if (authUserId == null) {
      fetchIdRef.current += 1;
      setCurrentUser(null);
      setLoading(false);
      setError(null);
      return;
    }
    refetch();
  }, [authUserId, refetch]);

  useEffect(() => {
    if (authUserId == null) return;
    const onPatched = (updated) => {
      if (String(updated?.id) !== String(authUserId)) return;
      refetch();
    };
    usersService.on('patched', onPatched);
    return () => usersService.off('patched', onPatched);
  }, [authUserId, refetch]);

  useEffect(() => {
    if (authUserId == null) return;
    return subscribeSseReconnect(refetch);
  }, [authUserId, refetch]);

  return (
    <CurrentUserContext.Provider
      value={{ currentUser, loading, error, refetch, updateCurrentUser }}
    >
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser() {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) {
    throw new Error('useCurrentUser must be used within CurrentUserProvider');
  }
  return ctx;
}
