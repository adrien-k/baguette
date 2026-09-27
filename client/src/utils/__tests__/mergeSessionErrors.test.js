import { describe, it, expect } from 'vitest';
import { isMergeSucceededArchiveFailed, mergeFailureToastLabel } from '../mergeSessionErrors.js';

describe('mergeSessionErrors', () => {
  it('detects merge success with archive failure', () => {
    const err = {
      message: 'PR merged successfully, but archiving failed: disk full',
    };
    expect(isMergeSucceededArchiveFailed(err)).toBe(true);
    expect(mergeFailureToastLabel(err)).toBe('PR merged, but archiving failed');
  });

  it('uses default label for other merge errors', () => {
    expect(mergeFailureToastLabel({ message: 'Conflict' })).toBe('Failed to merge PR');
  });
});
