import { describe, it, expect } from 'vitest';
import {
  sessionNeedsPrMetadataSync,
  touchPrMetadataUpdatedAtOnPatch,
} from '../session-git-status.js';

describe('sessionNeedsPrMetadataSync', () => {
  it('returns false without a PR number', () => {
    expect(
      sessionNeedsPrMetadataSync({
        pr_metadata_updated_at: '2026-01-02T00:00:00.000Z',
        last_pushed_at: null,
      })
    ).toBe(false);
  });

  it('returns true when metadata was updated after last push', () => {
    expect(
      sessionNeedsPrMetadataSync({
        pr_number: 1,
        pr_metadata_updated_at: '2026-01-02T12:00:00.000Z',
        last_pushed_at: '2026-01-02T00:00:00.000Z',
      })
    ).toBe(true);
  });

  it('returns false when metadata matches last push time', () => {
    const t = '2026-01-02T12:00:00.000Z';
    expect(
      sessionNeedsPrMetadataSync({
        pr_number: 1,
        pr_metadata_updated_at: t,
        last_pushed_at: t,
      })
    ).toBe(false);
  });
});

describe('touchPrMetadataUpdatedAtOnPatch', () => {
  it('sets pr_metadata_updated_at when label changes', () => {
    const data = { label: 'New' };
    const context = {
      data,
      params: { ownSession: { label: 'Old', pr_description: null, base_branch: 'main' } },
    };
    touchPrMetadataUpdatedAtOnPatch(context);
    expect(data.pr_metadata_updated_at).toBeTruthy();
  });

  it('does not set timestamp when PR fields are unchanged', () => {
    const data = { label: 'Same' };
    const context = {
      data,
      params: { ownSession: { label: 'Same', pr_description: null, base_branch: 'main' } },
    };
    touchPrMetadataUpdatedAtOnPatch(context);
    expect(data.pr_metadata_updated_at).toBeUndefined();
  });
});
