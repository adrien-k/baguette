/** Merge succeeded on GitHub but session archive failed (server BadRequest). */
export function isMergeSucceededArchiveFailed(err) {
  const msg = err?.message ?? '';
  return msg.includes('PR merged successfully') && /archiv/i.test(msg);
}

export function mergeFailureToastLabel(err) {
  return isMergeSucceededArchiveFailed(err)
    ? 'PR merged, but archiving failed'
    : 'Failed to merge PR';
}
