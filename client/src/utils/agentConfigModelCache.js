/**
 * Model-list cache transitions for the composer picker.
 * A background refetch must keep the previous list so the picker does not go blank.
 */

export function shouldFetchModels(status, { force = false } = {}) {
  if (status === 'loading') return false;
  if (force) return true;
  return status !== 'ready';
}

/** Models to show while a fetch is in flight. */
export function modelsKeptForFetch(entry) {
  return entry?.models ?? [];
}
