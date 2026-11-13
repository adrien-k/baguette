import { describe, expect, it } from 'vitest';
import { sessionMatchesListQuery } from '@baguette/shared/session-list-query.js';
import { applySessionRealtimeList, nextTrackedStatus } from '../sessionRealtime.js';

const query = { include_archived: true, include_loop_runs: true, all_sessions: true };
const repos = [{ id: 1, full_name: 'acme/a', show_in_all_sessions: true }];
const currentUserId = 7;

function matches(session) {
  return sessionMatchesListQuery(session, query, repos, { currentUserId });
}

const owned = {
  id: 10,
  user_id: 7,
  repo_id: 1,
  repo_full_name: 'acme/a',
  status: 'running',
  last_viewed_at: '2026-01-01T00:00:00.000Z',
};

describe('applySessionRealtimeList', () => {
  it('keeps a listed session when a last-viewed patch omits user_id', () => {
    const viewed = '2026-01-02T00:00:00.000Z';
    const { next, skipDelta } = applySessionRealtimeList(
      [owned],
      { id: 10, last_viewed_at: viewed },
      matches
    );
    expect(skipDelta).toBe(0);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: 10,
      user_id: 7,
      status: 'running',
      last_viewed_at: viewed,
    });
  });

  it('still records a later completed patch after a last-viewed merge', () => {
    const { next: afterViewed } = applySessionRealtimeList(
      [owned],
      { id: 10, last_viewed_at: '2026-01-02T00:00:00.000Z' },
      matches
    );
    const { next } = applySessionRealtimeList(
      afterViewed,
      { id: 10, status: 'completed' },
      matches
    );
    expect(next[0].status).toBe('completed');
    expect(next[0].user_id).toBe(7);
  });

  it('removes an unshared session from Shared with me', () => {
    const sharedQuery = { ...query, list_scope: 'shared' };
    const shared = { ...owned, user_id: 9, is_shared: 1 };
    const sharedMatches = (session) =>
      sessionMatchesListQuery(session, sharedQuery, repos, { currentUserId });
    const { next, skipDelta } = applySessionRealtimeList(
      [shared],
      { id: 10, user_id: 9, is_shared: 0 },
      sharedMatches
    );
    expect(skipDelta).toBe(-1);
    expect(next).toEqual([]);
  });
});

describe('nextTrackedStatus', () => {
  it('does not wipe a seeded status when a partial patch omits it', () => {
    expect(nextTrackedStatus('running', undefined)).toEqual({
      next: 'running',
      changed: false,
    });
  });

  it('still reports a completed transition after a partial patch', () => {
    const afterPartial = nextTrackedStatus('running', undefined);
    expect(nextTrackedStatus(afterPartial.next, 'completed')).toEqual({
      next: 'completed',
      changed: true,
    });
  });
});
