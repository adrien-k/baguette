import { useState, useEffect, createContext, useContext } from 'react';
import { apiFetch } from '../api.js';

const AuthContext = createContext(null);

const DEFAULT_GITHUB = { install_url: null };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [github, setGithub] = useState(DEFAULT_GITHUB);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/auth/me')
      .then((data) => {
        setUser(data.user);
        setGithub(data.github || DEFAULT_GITHUB);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, github, loading, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
