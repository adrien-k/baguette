import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usersService } from '../feathers.js';
import { useAuth } from './useAuth.jsx';
import { toastError } from '../utils/toastError.jsx';

const STORAGE_KEY = 'baguette-color-scheme';

const ColorSchemeContext = createContext(null);

function readStoredScheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function applyDocumentScheme(scheme) {
  document.documentElement.dataset.theme = scheme;
  document.documentElement.style.colorScheme = scheme;
}

export function ColorSchemeProvider({ children }) {
  const { user, setUser } = useAuth();
  const [colorScheme, setColorScheme] = useState(() => readStoredScheme() ?? 'dark');

  useEffect(() => {
    if (user?.color_scheme === 'light' || user?.color_scheme === 'dark') {
      setColorScheme(user.color_scheme);
    }
  }, [user?.color_scheme]);

  useEffect(() => {
    applyDocumentScheme(colorScheme);
    try {
      localStorage.setItem(STORAGE_KEY, colorScheme);
    } catch {
      // ignore private mode / blocked storage
    }
  }, [colorScheme]);

  const setColorSchemePersisted = useCallback(
    async (next) => {
      const scheme = next === 'light' ? 'light' : 'dark';
      const previous = colorScheme;
      setColorScheme(scheme);
      if (!user?.id) return;

      try {
        await usersService.patch(user.id, { color_scheme: scheme });
        setUser((current) => (current ? { ...current, color_scheme: scheme } : current));
      } catch (err) {
        setColorScheme(previous);
        applyDocumentScheme(previous);
        toastError('Failed to save theme preference', err);
      }
    },
    [colorScheme, setUser, user?.id]
  );

  const toggleColorScheme = useCallback(() => {
    setColorSchemePersisted(colorScheme === 'light' ? 'dark' : 'light');
  }, [colorScheme, setColorSchemePersisted]);

  return (
    <ColorSchemeContext.Provider
      value={{ colorScheme, setColorScheme: setColorSchemePersisted, toggleColorScheme }}
    >
      {children}
    </ColorSchemeContext.Provider>
  );
}

export function useColorScheme() {
  const ctx = useContext(ColorSchemeContext);
  if (!ctx) throw new Error('useColorScheme must be used within ColorSchemeProvider');
  return ctx;
}
