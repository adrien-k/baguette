import { useState, useEffect, useRef, useCallback } from 'react';
import { usersService } from '../feathers.js';
import { useAuth } from './useAuth.jsx';
import { toastError } from '../utils/toastError.jsx';
import { normalizeCursorModelPrefs, DEFAULT_CURSOR_MODEL_PREFS } from '../utils/agentPreferences.js';

const SAVE_DEBOUNCE_MS = 400;

/** User-level Cursor fast/effort toggles (shared across repos). */
export function useCursorModelPrefs() {
  const { user } = useAuth();
  const [cursorFast, setCursorFastState] = useState(DEFAULT_CURSOR_MODEL_PREFS.cursor_fast);
  const [cursorEffort, setCursorEffortState] = useState(DEFAULT_CURSOR_MODEL_PREFS.cursor_effort);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef(null);
  const userIdRef = useRef(null);
  const latestRef = useRef(DEFAULT_CURSOR_MODEL_PREFS);

  useEffect(() => {
    latestRef.current = { cursor_fast: cursorFast, cursor_effort: cursorEffort };
  }, [cursorFast, cursorEffort]);

  useEffect(() => {
    if (!user?.id) {
      setLoaded(false);
      return;
    }
    userIdRef.current = user.id;
    setLoaded(false);
    usersService
      .get(user.id)
      .then((d) => {
        const prefs = normalizeCursorModelPrefs(d.agent_preferences);
        setCursorFastState(prefs.cursor_fast);
        setCursorEffortState(prefs.cursor_effort);
        latestRef.current = prefs;
      })
      .catch((err) => toastError('Failed to load model preferences', err))
      .finally(() => setLoaded(true));
  }, [user?.id]);

  const flushSave = useCallback((prefs) => {
    const id = userIdRef.current;
    if (!id) return;
    usersService
      .patch(id, { agent_preferences: prefs })
      .catch((err) => toastError('Failed to save model preferences', err));
  }, []);

  const scheduleSave = useCallback(
    (next) => {
      latestRef.current = next;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => flushSave(next), SAVE_DEBOUNCE_MS);
    },
    [flushSave]
  );

  const setCursorFast = useCallback(
    (val) => {
      setCursorFastState(val);
      scheduleSave({ ...latestRef.current, cursor_fast: val });
    },
    [scheduleSave]
  );

  const setCursorEffort = useCallback(
    (val) => {
      setCursorEffortState(val);
      scheduleSave({ ...latestRef.current, cursor_effort: val });
    },
    [scheduleSave]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { cursorFast, cursorEffort, setCursorFast, setCursorEffort, loaded };
}
