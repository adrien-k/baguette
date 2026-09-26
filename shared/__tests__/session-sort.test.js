import { describe, it, expect } from 'vitest';
import { sortSessionsForList } from '../session-sort.js';

describe('sortSessionsForList', () => {
  it('orders non-archived before archived regardless of pr_status', () => {
    const merged = {
      id: 1,
      archived_at: null,
      pr_status: 'merged',
      last_activity_at: '2026-01-10T00:00:00.000Z',
    };
    const active = {
      id: 2,
      archived_at: null,
      pr_status: 'open',
      last_activity_at: '2026-01-01T00:00:00.000Z',
    };
    const archived = {
      id: 3,
      archived_at: '2026-02-01T00:00:00.000Z',
      pr_status: 'open',
      last_activity_at: '2026-03-01T00:00:00.000Z',
    };

    expect(sortSessionsForList([archived, merged, active]).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('orders by last activity within each archive group', () => {
    const older = {
      id: 1,
      archived_at: null,
      last_activity_at: '2026-01-01T00:00:00.000Z',
    };
    const newer = {
      id: 2,
      archived_at: null,
      last_activity_at: '2026-02-01T00:00:00.000Z',
    };

    expect(sortSessionsForList([older, newer]).map((s) => s.id)).toEqual([2, 1]);
  });
});
