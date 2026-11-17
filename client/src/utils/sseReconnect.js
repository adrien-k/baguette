const listeners = new Set();
const pauseListeners = new Set();
const resumeCatchUpListeners = new Set();

/** Debounce refetch fan-out so a flaky reconnect does not stampede the API. */
const SSE_REFETCH_DEBOUNCE_MS = 250;

/** @type {ReturnType<typeof setTimeout> | null} */
let notifyTimer = null;

let skipNextReconnectRefetch = false;
let resumeCatchUpInFlight = false;
/** True from stream pause until the post-delay catch-up refetch finishes. */
let focusRefetchSuppressed = false;

/** @internal Test helper. */
export function isSseResumeCatchUpInFlight() {
  return resumeCatchUpInFlight;
}

/** Window-focus refetch stays off for the whole resume, including the delay before catch-up. */
export function isSseFocusRefetchSuppressed() {
  return focusRefetchSuppressed;
}

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
 * usually mark cached server state stale so the next focus or reconnect refetches.
 */
export function subscribeSseStreamPaused(listener) {
  pauseListeners.add(listener);
  return () => pauseListeners.delete(listener);
}

/** @internal Called when the fetch SSE stream is aborted due to hidden tab or offline. */
export function notifySseStreamPaused() {
  focusRefetchSuppressed = true;
  flushSseStreamPausedListeners();
}

/**
 * Subscribe to the pre-connect catch-up refetch (tab resume while stream paused).
 * Listeners should return a promise that settles when active queries are refreshed.
 */
export function subscribeSseResumeCatchUp(listener) {
  resumeCatchUpListeners.add(listener);
  return () => resumeCatchUpListeners.delete(listener);
}

/**
 * Refetch active queries while the SSE stream is still down, before `app.setup()`.
 * Marks the next `connected` event to skip the debounced post-connect refetch.
 */
export async function runSseResumeCatchUp() {
  if (resumeCatchUpListeners.size === 0) {
    focusRefetchSuppressed = false;
    return;
  }
  resumeCatchUpInFlight = true;
  skipNextReconnectRefetch = true;
  try {
    const results = [...resumeCatchUpListeners].map((listener) => listener());
    await Promise.all(results);
  } finally {
    resumeCatchUpInFlight = false;
    focusRefetchSuppressed = false;
  }
}

/** @internal Skip duplicate refetch after resume catch-up already ran. */
export function consumeSkipSseReconnectRefetch() {
  if (!skipNextReconnectRefetch) return false;
  skipNextReconnectRefetch = false;
  return true;
}

/** Drop a pending skip when resume is aborted before the stream opens. */
export function clearSkipSseReconnectRefetch() {
  skipNextReconnectRefetch = false;
}

/** Logout stops the lifecycle; focus refetch should not stay suppressed. */
export function clearSseFocusRefetchSuppression() {
  focusRefetchSuppressed = false;
}

/** @internal Test helper — reset reconnect skip / in-flight flags. */
export function resetSseReconnectStateForTests() {
  skipNextReconnectRefetch = false;
  resumeCatchUpInFlight = false;
  focusRefetchSuppressed = false;
  if (notifyTimer != null) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
}

export function notifySseReconnect() {
  if (skipNextReconnectRefetch) return;
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
