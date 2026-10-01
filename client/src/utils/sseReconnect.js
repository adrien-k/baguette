const listeners = new Set();

/** Debounce refetch fan-out so a flaky reconnect does not stampede the API. */
export const SSE_REFETCH_DEBOUNCE_MS = 250;

/** @type {ReturnType<typeof setTimeout> | null} */
let notifyTimer = null;

function flushSseReconnectListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* listener errors must not break reconnect handling */
    }
  }
}

/** Subscribe to SSE reconnect after the tab becomes visible/online again. */
export function subscribeSseReconnect(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifySseReconnect() {
  if (notifyTimer != null) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    flushSseReconnectListeners();
  }, SSE_REFETCH_DEBOUNCE_MS);
}

/** @internal Test helper — runs pending debounced notifications immediately. */
export function flushSseReconnectNotifyForTests() {
  if (notifyTimer != null) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  flushSseReconnectListeners();
}
