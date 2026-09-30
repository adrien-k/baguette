const listeners = new Set();

/** Subscribe to SSE reconnect after the tab becomes visible/online again. */
export function subscribeSseReconnect(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifySseReconnect() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* listener errors must not break reconnect handling */
    }
  }
}
