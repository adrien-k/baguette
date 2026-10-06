/** Wait before reopening SSE so the network can settle (hidden/offline or after a drop). */
export const SSE_RECONNECT_DELAY_MS = 500;

/** @see EventSource.readyState when the browser will not retry on its own */
const EVENT_SOURCE_CLOSED = 2;

/**
 * Keeps the live event stream open while the tab is visible and the browser is online.
 * Closes on hidden/offline; reconnects after drops, visible/online, and runs `onReconnect`
 * after every reopen once the stream has opened at least once.
 *
 * @param {{
 *   url: string,
 *   onMessage: (event: MessageEvent) => void,
 *   onReconnect?: () => void,
 *   withCredentials?: boolean,
 *   reconnectDelayMs?: number,
 *   getVisibility?: () => DocumentVisibilityState,
 *   getOnline?: () => boolean,
 *   EventSourceImpl?: typeof EventSource,
 *   setTimeoutImpl?: typeof setTimeout,
 *   clearTimeoutImpl?: typeof clearTimeout,
 *   addEventListener?: typeof document.addEventListener,
 *   removeEventListener?: typeof document.removeEventListener,
 *   addWindowListener?: typeof window.addEventListener,
 *   removeWindowListener?: typeof window.removeEventListener,
 * }} options
 */
export function createSseManager({
  url,
  onMessage,
  onReconnect,
  withCredentials = true,
  reconnectDelayMs = SSE_RECONNECT_DELAY_MS,
  getVisibility = () => document.visibilityState,
  getOnline = () => navigator.onLine,
  EventSourceImpl = EventSource,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  addEventListener = document.addEventListener.bind(document),
  removeEventListener = document.removeEventListener.bind(document),
  addWindowListener = window.addEventListener.bind(window),
  removeWindowListener = window.removeEventListener.bind(window),
}) {
  /** @type {EventSource | null} */
  let source = null;
  let paused = false;
  let hadOpen = false;
  let started = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;

  const shouldConnect = () => getVisibility() !== 'hidden' && getOnline();

  const clearReconnectTimer = () => {
    if (reconnectTimer == null) return;
    clearTimeoutImpl(reconnectTimer);
    reconnectTimer = null;
  };

  const disconnect = (becausePaused) => {
    clearReconnectTimer();
    if (becausePaused) paused = true;
    if (!source) return;
    source.close();
    source = null;
  };

  const connectNow = () => {
    if (source || !shouldConnect()) return;
    source = new EventSourceImpl(url, { withCredentials });
    source.onmessage = onMessage;
    source.onopen = () => {
      const reconnecting = hadOpen || paused;
      if (!hadOpen) hadOpen = true;
      paused = false;
      if (reconnecting) onReconnect?.();
    };
    source.onerror = () => {
      if (!started || !shouldConnect() || !source) return;
      if (source.readyState !== EVENT_SOURCE_CLOSED) return;
      source = null;
      paused = true;
      scheduleConnect();
    };
  };

  const scheduleConnect = () => {
    if (source || !shouldConnect()) return;
    if (!paused || reconnectDelayMs <= 0) {
      connectNow();
      return;
    }
    clearReconnectTimer();
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      connectNow();
    }, reconnectDelayMs);
  };

  const sync = () => {
    if (!started) return;
    if (shouldConnect()) scheduleConnect();
    else disconnect(true);
  };

  const start = () => {
    if (started) return;
    started = true;
    addEventListener('visibilitychange', sync);
    addWindowListener('online', sync);
    addWindowListener('offline', sync);
    sync();
  };

  const stop = () => {
    if (!started) return;
    removeEventListener('visibilitychange', sync);
    removeWindowListener('online', sync);
    removeWindowListener('offline', sync);
    started = false;
    paused = false;
    hadOpen = false;
    clearReconnectTimer();
    disconnect(false);
  };

  return { start, stop, sync };
}
