/** EventSource.CLOSED — the browser gave up and will not retry on its own. */
const CLOSED = 2;

/** How long the stream must stay down before we bother the user about it. */
export const RECONNECT_GRACE_MS = 4000;

/**
 * Watch an EventSource and report sustained disconnections.
 *
 * The browser reconnects a dropped EventSource by itself, so a brief blip (server
 * restart, network hiccup) is not worth a toast: `onLost` fires only once the
 * stream has been down for `graceMs`, or immediately when the browser has given
 * up entirely (readyState CLOSED). `onLost` is only called if the stream had
 * opened at least once (e.g. skip warnings when never authenticated).
 * `onRestored` fires on the next successful connection, but only if `onLost` fired first.
 *
 * @param {EventSource} source
 * @param {{ onLost?: () => void, onRestored?: () => void, graceMs?: number }} [handlers]
 * @returns {{ unsubscribe: () => void, onLogout: () => void }}
 */
export function watchSseConnection(
  source,
  { onLost, onRestored, graceMs = RECONNECT_GRACE_MS } = {}
) {
  let timer = null;
  let lost = false;
  let everOpen = false;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const reportLost = () => {
    timer = null;
    if (!everOpen || lost) return;
    lost = true;
    onLost?.();
  };

  source.onopen = () => {
    everOpen = true;
    clearTimer();
    if (!lost) return;
    lost = false;
    onRestored?.();
  };

  source.onerror = () => {
    if (source.readyState === CLOSED) {
      clearTimer();
      reportLost();
      return;
    }
    // Still retrying — give it a chance to come back before warning.
    if (timer === null && !lost) timer = setTimeout(reportLost, graceMs);
  };

  const unsubscribe = () => {
    clearTimer();
    source.onopen = null;
    source.onerror = null;
  };

  const onLogout = () => {
    everOpen = false;
    lost = false;
    clearTimer();
  };

  return { unsubscribe, onLogout };
}
