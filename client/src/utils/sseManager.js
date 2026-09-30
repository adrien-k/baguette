/**
 * Keeps the live event stream open only while the tab is visible and the browser is online.
 * Closes on hidden/offline; opens again on visible/online and runs `onReconnect` after reopen.
 *
 * @param {{
 *   url: string,
 *   onMessage: (event: MessageEvent) => void,
 *   onReconnect?: () => void,
 *   withCredentials?: boolean,
 *   getVisibility?: () => DocumentVisibilityState,
 *   getOnline?: () => boolean,
 *   EventSourceImpl?: typeof EventSource,
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
  getVisibility = () => document.visibilityState,
  getOnline = () => navigator.onLine,
  EventSourceImpl = EventSource,
  addEventListener = document.addEventListener.bind(document),
  removeEventListener = document.removeEventListener.bind(document),
  addWindowListener = window.addEventListener.bind(window),
  removeWindowListener = window.removeEventListener.bind(window),
}) {
  /** @type {EventSource | null} */
  let source = null;
  let paused = false;
  let started = false;

  const shouldConnect = () => getVisibility() !== 'hidden' && getOnline();

  const disconnect = (becausePaused) => {
    if (becausePaused) paused = true;
    if (!source) return;
    source.close();
    source = null;
  };

  const connect = () => {
    if (source || !shouldConnect()) return;
    source = new EventSourceImpl(url, { withCredentials });
    source.onmessage = onMessage;
    source.onopen = () => {
      if (!paused) return;
      paused = false;
      onReconnect?.();
    };
  };

  const sync = () => {
    if (!started) return;
    if (shouldConnect()) connect();
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
    disconnect(false);
  };

  return { start, stop, sync };
}
