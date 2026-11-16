import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { apiFetch } from '../api.js';
import { clearSseConnectionOnLogout } from '../feathers.js';
import { queryClient } from '../queries/queryClientInstance.js';
import {
  DEFAULT_BOOTSTRAP,
  DEFAULT_GITHUB,
  DEFAULT_PASSKEYS,
  parseAuthMe,
} from '../utils/authMe.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [github, setGithub] = useState(DEFAULT_GITHUB);
  const [bootstrap, setBootstrap] = useState(DEFAULT_BOOTSTRAP);
  const [passkeys, setPasskeys] = useState(DEFAULT_PASSKEYS);
  const [loading, setLoading] = useState(true);
  // Identity whose server-state cache is currently valid. `undefined` until
  // the first /auth/me resolves (nothing cached yet worth clearing).
  const appliedUserIdRef = useRef(undefined);

  /**
   * The module-level QueryClient outlives React providers, and login can
   * happen in-SPA (refreshAuth → setUser) without a page reload. Clear the
   * cache synchronously whenever the signed-in identity changes so the next
   * account never renders the previous one's cached sessions/messages/repos.
   *
   * Clearing here — before the new identity reaches state — matters: a clear
   * in a post-mount effect would run after child providers have already
   * started their queries for the new user, wiping them mid-flight.
   * Functional updates (same-user patches like onboarding/color scheme) skip
   * the guard; they never change identity.
   */
  const setAuthUser = useCallback((value) => {
    if (typeof value === 'function') {
      setUser(value);
      return;
    }
    const nextUserId = value?.id ?? null;
    if (nextUserId !== appliedUserIdRef.current) {
      appliedUserIdRef.current = nextUserId;
      queryClient.clear();
    }
    setUser(value);
  }, []);

  const applyAuthMe = useCallback(
    (data) => {
      const parsed = parseAuthMe(data);
      setAuthUser(parsed.user);
      setGithub(parsed.github);
      setBootstrap(parsed.bootstrap);
      setPasskeys(parsed.passkeys);
      return parsed;
    },
    [setAuthUser]
  );

  useEffect(() => {
    apiFetch('/auth/me')
      .then(applyAuthMe)
      .catch(() => {
        setAuthUser(null);
        setGithub(DEFAULT_GITHUB);
        setBootstrap(DEFAULT_BOOTSTRAP);
        setPasskeys(DEFAULT_PASSKEYS);
      })
      .finally(() => setLoading(false));
  }, [applyAuthMe, setAuthUser]);

  const refreshAuth = async () => {
    const data = await apiFetch('/auth/me');
    return applyAuthMe(data);
  };

  const logout = async () => {
    clearSseConnectionOnLogout();
    await apiFetch('/auth/logout', { method: 'POST' });
    setAuthUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        github,
        bootstrap,
        passkeys,
        loading,
        logout,
        setUser: setAuthUser,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
