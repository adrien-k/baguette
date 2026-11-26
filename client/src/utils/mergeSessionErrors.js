/** Merge succeeded on GitHub but session archive failed (server BadRequest). */
export function isMergeSucceededArchiveFailed(err) {
  const msg = err?.message ?? '';
  return msg.includes('PR merged successfully') && /archiv/i.test(msg);
}

export function mergeFailureToastLabel(err, { localMerge = false } = {}) {
  if (isMergeSucceededArchiveFailed(err)) {
    return localMerge ? 'Merged, but archiving failed' : 'PR merged, but archiving failed';
  }
  return localMerge ? 'Failed to merge' : 'Failed to merge PR';
}
