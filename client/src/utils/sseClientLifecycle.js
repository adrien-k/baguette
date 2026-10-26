/** Wait before reopening SSE so the network can settle (hidden/offline or after a drop). */
const SSE_RECONNECT_DELAY_MS = 500;

/**
 * Pauses the v6 fetch SSE stream when the tab is hidden or offline (abort), and
 * reconnects via teardown/setup when visible/online again. Also cancels the
 * built-in sseClient backoff when a drop happens while the tab is hidden, so a
 * hidden tab does not reopen a live stream. Logout should set `shouldConnect`
 * to false and abort the controller separately.
 *
 * @param {{
 *   app: import('feathers').Application,
 *   getAbortController: () => AbortController | null,
 *   clearAbortController: () => void,
 *   shouldConnect: () => boolean,
 *   reconnectDelayMs?: number,
 *   getVisibility?: () => DocumentVisibilityState,
 *   getOnline?: () => boolean,
 * }} options
 */
export function configureSsePauseAndReconnect({
  app,
  getAbortController,
  clearAbortController,
  shouldConnect,
  reconnectDelayMs = SSE_RECONNECT_DELAY_MS,
  getVisibility = () => document.visibilityState,
  getOnline = () => navigator.onLine,
}) {
  let started = false;
  let paused = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let feathersReconnectTimeout = null;
  /** @type {{ on: Function, removeListener: Function } | null} */
  let sseService = null;

  const isVisibleAndOnline = () => getVisibility() !== 'hidden' && getOnline();
  const shouldStayConnected = () => shouldConnect() && isVisibleAndOnline();

  const isStreamOpen = () => {
    const controller = getAbortController();
    return controller != null && !controller.signal.aborted;
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer == null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const cancelFeathersReconnect = () => {
    if (feathersReconnectTimeout == null) return;
    clearTimeout(feathersReconnectTimeout);
    feathersReconnectTimeout = null;
  };

  const pauseStream = () => {
    clearReconnectTimer();
    cancelFeathersReconnect();
    const controller = getAbortController();
    if (!controller || controller.signal.aborted) {
      paused = true;
      return;
    }
    controller.abort();
    clearAbortController();
    paused = true;
  };

  const reconnect = () => {
    if (!started || !shouldStayConnected()) return;
    if (isStreamOpen()) return;
    if (!paused) return;
    clearReconnectTimer();
    if (reconnectDelayMs <= 0) {
      void app.teardown().then(() => app.setup());
      paused = false;
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!started || !shouldStayConnected()) return;
      void app.teardown().then(() => app.setup());
      paused = false;
    }, reconnectDelayMs);
  };

  const sync = () => {
    if (!started) return;
    if (!shouldConnect()) return;
    if (isVisibleAndOnline()) reconnect();
    else pauseStream();
  };

  const onReconnecting = (info) => {
    feathersReconnectTimeout = info?.timeout ?? null;
    if (!started || shouldStayConnected()) return;
    cancelFeathersReconnect();
    paused = true;
  };

  const onDisconnected = () => {
    if (!started || shouldStayConnected()) return;
    paused = true;
  };

  const onConnected = () => {
    if (!started) return;
    if (shouldStayConnected()) {
      paused = false;
      return;
    }
    pauseStream();
  };

  const start = () => {
    if (started) return;
    started = true;
    sseService = app.service('sse');
    sseService.on('reconnecting', onReconnecting);
    sseService.on('disconnected', onDisconnected);
    sseService.on('connected', onConnected);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
  };

  const stop = () => {
    if (!started) return;
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('online', sync);
    window.removeEventListener('offline', sync);
    sseService?.removeListener('reconnecting', onReconnecting);
    sseService?.removeListener('disconnected', onDisconnected);
    sseService?.removeListener('connected', onConnected);
    sseService = null;
    started = false;
    paused = false;
    clearReconnectTimer();
    pauseStream();
  };

  return { start, stop };
}
