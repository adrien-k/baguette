import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { apiFetch } from '../api.js';
import { clearSseConnectionOnLogout } from '../feathers.js';
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

  const applyAuthMe = useCallback((data) => {
    const parsed = parseAuthMe(data);
    setUser(parsed.user);
    setGithub(parsed.github);
    setBootstrap(parsed.bootstrap);
    setPasskeys(parsed.passkeys);
    return parsed;
  }, []);

  useEffect(() => {
    apiFetch('/auth/me')
      .then(applyAuthMe)
      .catch(() => {
        setUser(null);
        setGithub(DEFAULT_GITHUB);
        setBootstrap(DEFAULT_BOOTSTRAP);
        setPasskeys(DEFAULT_PASSKEYS);
      })
      .finally(() => setLoading(false));
  }, [applyAuthMe]);

  const refreshAuth = async () => {
    const data = await apiFetch('/auth/me');
    return applyAuthMe(data);
  };

  const logout = async () => {
    clearSseConnectionOnLogout();
    await apiFetch('/auth/logout', { method: 'POST' });
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, github, bootstrap, passkeys, loading, logout, setUser, refreshAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
