import {
  clearSkipSseReconnectRefetch,
  clearSseFocusRefetchSuppression,
  notifySseStreamPaused,
  runSseResumeCatchUp,
} from './sseReconnect.js';

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
  /** @type {Promise<void> | null} */
  let reconnectWork = null;
  /** @type {((result: 'ready' | 'aborted') => void) | null} */
  let finishDelay = null;

  const isVisibleAndOnline = () => getVisibility() !== 'hidden' && getOnline();
  const shouldStayConnected = () => shouldConnect() && isVisibleAndOnline();

  const isStreamOpen = () => {
    const controller = getAbortController();
    return controller != null && !controller.signal.aborted;
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (finishDelay == null) return;
    const finish = finishDelay;
    finishDelay = null;
    finish('aborted');
  };

  const waitBeforeCatchUp = () => {
    if (reconnectDelayMs <= 0) return Promise.resolve(/** @type {'ready'} */ ('ready'));
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (reconnectTimer != null) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        finishDelay = null;
        resolve(result);
      };
      finishDelay = finish;
      reconnectTimer = setTimeout(() => finish('ready'), reconnectDelayMs);
    });
  };

  const cancelFeathersReconnect = () => {
    if (feathersReconnectTimeout == null) return;
    clearTimeout(feathersReconnectTimeout);
    feathersReconnectTimeout = null;
  };

  const enterPausedState = () => {
    const entering = !paused;
    paused = true;
    if (entering) notifySseStreamPaused();
  };

  const pauseStream = () => {
    clearReconnectTimer();
    cancelFeathersReconnect();
    const controller = getAbortController();
    if (!controller || controller.signal.aborted) {
      enterPausedState();
      return;
    }
    controller.abort();
    clearAbortController();
    enterPausedState();
  };

  const abandonResume = () => {
    clearSkipSseReconnectRefetch();
  };

  const openStreamAfterCatchUp = async (markSetupStarted) => {
    const waited = await waitBeforeCatchUp();
    if (waited !== 'ready') return;
    if (!started || !shouldStayConnected()) return;
    try {
      await runSseResumeCatchUp();
      if (!started || !shouldStayConnected() || isStreamOpen()) {
        abandonResume();
        return;
      }
      await app.teardown();
      if (!started || !shouldStayConnected()) {
        abandonResume();
        return;
      }
      markSetupStarted();
      await app.setup();
      // The controller arrives on `connected`, which clears `paused` when the
      // tab is still visible. Do not treat a resolved setup as a live stream.
      if (started && shouldStayConnected() && isStreamOpen()) paused = false;
    } catch (error) {
      abandonResume();
      throw error;
    }
  };

  const reconnect = () => {
    if (!started || !shouldStayConnected()) return;
    if (isStreamOpen()) return;
    if (!paused) return;
    if (reconnectWork != null) return;
    // `app.setup()` resolves before the SSE `connected` event stores the
    // AbortController. Retry only when that call never started (delay aborted
    // or catch-up bailed). A handshake that is still opening is left alone
    // until `connected` or `disconnected`.
    let setupStarted = false;
    const work = openStreamAfterCatchUp(() => {
      setupStarted = true;
    });
    reconnectWork = work.finally(() => {
      reconnectWork = null;
      if (setupStarted) return;
      if (started && paused && shouldStayConnected() && !isStreamOpen()) reconnect();
    });
  };

  const sync = () => {
    if (!started) return;
    if (!shouldConnect()) return;
    if (isVisibleAndOnline()) reconnect();
    else pauseStream();
  };

  const onReconnecting = (info) => {
    feathersReconnectTimeout = info?.timeout ?? null;
    if (!started) return;
    if (shouldStayConnected()) return;
    cancelFeathersReconnect();
    enterPausedState();
  };

  const onDisconnected = () => {
    if (!started) return;
    if (shouldStayConnected()) return;
    enterPausedState();
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
    clearSseFocusRefetchSuppression();
  };

  return { start, stop };
}
