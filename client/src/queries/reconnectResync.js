/** Debounce so a flapping socket does not reload every active query on each blip. */
const RESYNC_DEBOUNCE_MS = 250;

/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;
let generation = 0;
/** @type {Array<() => void> | null} */
let pendingWrites = null;

/**
 * Run a cache write now, or after the in-flight reconnect reload commits.
 * Live events during that reload used to land in the cache and then get
 * replaced by the HTTP snapshot (missing messages, tasks, and similar rows).
 */
export function runAfterReconnectResync(write) {
  if (pendingWrites) {
    pendingWrites.push(write);
    return;
  }
  write();
}

function flushPendingWrites() {
  const queued = pendingWrites ?? [];
  pendingWrites = null;
  for (const write of queued) {
    try {
      write();
    } catch {
      /* one cache write must not drop the rest of the queued events */
    }
  }
}

/**
 * Reload every active query from the server and mark the rest stale.
 * `gen` must be the current `generation`; a newer schedule leaves this run's
 * queued events for that newer reload to apply.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {number} gen
 */
async function reloadActiveQueries(queryClient, gen) {
  if (gen !== generation) return;
  if (!pendingWrites) pendingWrites = [];
  try {
    await queryClient.invalidateQueries(undefined, { cancelRefetch: true });
  } finally {
    if (gen === generation) flushPendingWrites();
  }
}

/**
 * Reload active queries immediately. Cancels a debounced reload so the queue
 * has a single owner.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 */
export function resyncActiveQueriesFromServer(queryClient) {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  const gen = ++generation;
  return reloadActiveQueries(queryClient, gen);
}

/**
 * Schedule a reconnect reload. Repeated calls within the debounce window
 * collapse into one reload.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 */
export function scheduleReconnectResync(queryClient) {
  if (timer != null) clearTimeout(timer);
  const gen = ++generation;
  timer = setTimeout(() => {
    timer = null;
    void reloadActiveQueries(queryClient, gen).catch(() => {
      /* invalidateQueries already records per-query errors */
    });
  }, RESYNC_DEBOUNCE_MS);
}

/** @internal Test helper. */
export function resetReconnectResyncForTests() {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  generation += 1;
  pendingWrites = null;
}
