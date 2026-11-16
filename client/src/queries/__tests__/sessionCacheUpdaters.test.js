import { afterEach, describe, expect, it } from 'vitest';
import { sessionMatchesListQuery } from '@baguette/shared/session-list-query.js';
import { sortSessionsForList } from '@baguette/shared/session-sort.js';
import { setRealtimeScope } from '../realtimeScope.js';
import {
  applyAgentEventToDetail,
  applyAgentEventToInfiniteList,
  applySessionEventToDetail,
  applySessionEventToInfiniteList,
  mergeSessionDetail,
  removeSessionFromInfiniteList,
} from '../sessionCacheUpdaters.js';

const listQuery = { include_archived: true, include_loop_runs: true, all_sessions: true };
const repos = [{ id: 1, full_name: 'acme/a', show_in_in_all: false, show_in_all_sessions: true }];
const currentUserId = 7;

function matches(session) {
  return sessionMatchesListQuery(session, listQuery, repos, { currentUserId });
}

const owned = {
  id: 10,
  user_id: 7,
  repo_id: 1,
  repo_full_name: 'acme/a',
  status: 'running',
  last_viewed_at: '2026-01-01T00:00:00.000Z',
};

function infiniteData(rows) {
  return {
    pages: [{ data: rows, total: rows.length }],
    pageParams: [0],
  };
}

function flatten(data) {
  return data.pages.flatMap((page) => page.data);
}

afterEach(() => setRealtimeScope({ repos: [], currentUserId: null }));

describe('mergeSessionDetail', () => {
  it('keeps previous counts when a patch omits them', () => {
    const prev = { id: 10, status: 'running', open_issues_count: 2, running_tasks_count: 1 };
    const next = mergeSessionDetail(prev, { id: 10, status: 'completed' });
    expect(next).toEqual({
      id: 10,
      status: 'completed',
      open_issues_count: 2,
      running_tasks_count: 1,
    });
  });

  it('accepts updated counts when present', () => {
    const prev = { id: 10, open_issues_count: 2 };
    const next = mergeSessionDetail(prev, { id: 10, open_issues_count: 0 });
    expect(next.open_issues_count).toBe(0);
  });
});

describe('applySessionEventToInfiniteList', () => {
  it('merges a patch into the matching page row', () => {
    const data = infiniteData([owned]);
    const next = applySessionEventToInfiniteList(data, { id: 10, status: 'completed' }, matches);
    expect(next).not.toBe(data);
    expect(flatten(next)).toEqual([{ ...owned, status: 'completed' }]);
  });

  it('inserts a created row at the front', () => {
    const data = infiniteData([owned]);
    const created = { ...owned, id: 11, status: 'running' };
    const next = applySessionEventToInfiniteList(data, created, matches);
    expect(flatten(next)).toEqual([created, owned]);
  });

  it('drops a row that no longer matches its filter', () => {
    const data = infiniteData([owned]);
    const next = applySessionEventToInfiniteList(
      data,
      { id: 10, user_id: 99 },
      (row) => row.user_id === 7
    );
    expect(flatten(next)).toEqual([]);
  });

  it('returns the same reference when nothing changed', () => {
    const data = infiniteData([owned]);
    expect(applySessionEventToInfiniteList(data, { id: 99, status: 'running' }, matches)).toBe(
      data
    );
  });
});

describe('applyAgentEventToInfiniteList', () => {
  it('applies agent patches to the session row and re-sorts', () => {
    const older = {
      ...owned,
      id: 9,
      agents: [{ id: 5, ref: 1, name: 'builder', status: 'idle' }],
    };
    const newer = { ...owned, id: 10 };
    const data = infiniteData(sortSessionsForList([older, newer]));
    const agent = { session_id: 9, id: 5, ref: 1, name: 'builder', status: 'running' };
    const next = applyAgentEventToInfiniteList(data, agent);
    expect(next).not.toBe(data);
    const rows = flatten(next);
    expect(rows.find((r) => r.id === 9).agents[0]).toMatchObject({ id: 5, status: 'running' });
  });

  it('returns the same reference when no row matches the agent session', () => {
    const data = infiniteData([owned]);
    expect(applyAgentEventToInfiniteList(data, { session_id: 55 })).toBe(data);
  });
});

describe('applySessionEventToDetail', () => {
  it('merges patches for the same session only', () => {
    const detail = { id: 10, status: 'running', open_issues_count: 3 };
    expect(applySessionEventToDetail(detail, { id: 10, status: 'completed' })).toMatchObject({
      status: 'completed',
      open_issues_count: 3,
    });
    expect(applySessionEventToDetail(detail, { id: 11, status: 'completed' })).toBe(detail);
    expect(applySessionEventToDetail(null, { id: 11 })).toBe(null);
  });
});

describe('applyAgentEventToDetail', () => {
  it('applies agent patches for its session only', () => {
    const detail = {
      id: 10,
      status: 'idle',
      agents: [{ id: 5, ref: 1, name: 'builder', status: 'idle' }],
    };
    const next = applyAgentEventToDetail(detail, {
      session_id: 10,
      id: 5,
      ref: 1,
      name: 'builder',
      status: 'running',
    });
    expect(next.agents[0]).toMatchObject({ id: 5, status: 'running' });
    expect(applyAgentEventToDetail(detail, { session_id: 11, id: 5, status: 'running' })).toBe(
      detail
    );
  });
});

describe('removeSessionFromInfiniteList', () => {
  it('removes the session row across pages', () => {
    const data = infiniteData([owned, { ...owned, id: 11 }]);
    const next = removeSessionFromInfiniteList(data, 11);
    expect(flatten(next)).toEqual([owned]);
    expect(removeSessionFromInfiniteList(data, 99)).toBe(data);
  });
});
