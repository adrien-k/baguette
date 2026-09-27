import { useState, useEffect, useRef, useCallback } from 'react';
import { usersService } from '../feathers.js';
import { useAuth } from './useAuth.jsx';
import { toastError } from '../utils/toastError.jsx';
import {
  normalizeCursorModelPrefs,
  DEFAULT_CURSOR_MODEL_PREFS,
} from '../utils/agentPreferences.js';

const SAVE_DEBOUNCE_MS = 400;

/** User-level Cursor model param preferences (shared across repos). */
export function useCursorModelPrefs() {
  const { user } = useAuth();
  const [cursorModelPrefs, setCursorModelPrefsState] = useState(DEFAULT_CURSOR_MODEL_PREFS);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef(null);
  const userIdRef = useRef(null);
  /** Keys queued for the next debounced patch (partial agent_preferences). */
  const pendingPatchRef = useRef({});

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
        setCursorModelPrefsState(prefs);
      })
      .catch((err) => toastError('Failed to load model preferences', err))
      .finally(() => setLoaded(true));
  }, [user?.id]);

  const flushSave = useCallback(() => {
    const id = userIdRef.current;
    const patch = pendingPatchRef.current;
    const keys = Object.keys(patch);
    if (!id || !keys.length) return;
    pendingPatchRef.current = {};
    usersService
      .patch(id, { agent_preferences: patch })
      .catch((err) => toastError('Failed to save model preferences', err));
  }, []);

  const scheduleSaveKey = useCallback(
    (key, val) => {
      pendingPatchRef.current[key] = val;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => flushSave(), SAVE_DEBOUNCE_MS);
    },
    [flushSave]
  );

  const setCursorModelPref = useCallback(
    (key, val) => {
      setCursorModelPrefsState((prev) => ({ ...prev, [key]: val }));
      scheduleSaveKey(key, val);
    },
    [scheduleSaveKey]
  );

  const setCursorFast = useCallback(
    (val) => setCursorModelPref('cursor_fast', val),
    [setCursorModelPref]
  );
  const setCursorEffort = useCallback(
    (val) => setCursorModelPref('cursor_effort', val),
    [setCursorModelPref]
  );
  const setCursorReasoning = useCallback(
    (val) => setCursorModelPref('cursor_reasoning', val),
    [setCursorModelPref]
  );
  const setCursorThinking = useCallback(
    (val) => setCursorModelPref('cursor_thinking', val),
    [setCursorModelPref]
  );
  const setCursorContext = useCallback(
    (val) => setCursorModelPref('cursor_context', val),
    [setCursorModelPref]
  );
  const setCursorCyber = useCallback(
    (val) => setCursorModelPref('cursor_cyber', val),
    [setCursorModelPref]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return {
    cursorModelPrefs,
    setCursorModelPref,
    cursorFast: cursorModelPrefs.cursor_fast,
    cursorEffort: cursorModelPrefs.cursor_effort,
    cursorReasoning: cursorModelPrefs.cursor_reasoning,
    cursorThinking: cursorModelPrefs.cursor_thinking,
    cursorContext: cursorModelPrefs.cursor_context,
    cursorCyber: cursorModelPrefs.cursor_cyber,
    setCursorFast,
    setCursorEffort,
    setCursorReasoning,
    setCursorThinking,
    setCursorContext,
    setCursorCyber,
    loaded,
  };
}
