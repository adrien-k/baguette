const listeners = new Set();
const pauseListeners = new Set();

function flushSseReconnectListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* listener errors must not break reconnect handling */
    }
  }
}

/** Subscribe when the live event stream reconnects (drop, tab visible, or online again). */
export function subscribeSseReconnect(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function flushSseStreamPausedListeners() {
  for (const listener of pauseListeners) {
    try {
      listener();
    } catch {
      /* listener errors must not break pause handling */
    }
  }
}

/**
 * Subscribe when the SSE stream is paused (hidden tab or offline). Listeners
 * usually mark cached server state stale so the next mount or reconnect reloads it.
 */
export function subscribeSseStreamPaused(listener) {
  pauseListeners.add(listener);
  return () => pauseListeners.delete(listener);
}

/** @internal Called when the fetch SSE stream is aborted due to hidden tab or offline. */
export function notifySseStreamPaused() {
  flushSseStreamPausedListeners();
}

/** @internal Called when the SSE stream opens after it had already connected once. */
export function notifySseReconnect() {
  flushSseReconnectListeners();
}
