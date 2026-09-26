import { describe, it, expect } from 'vitest';
import { sessionMatchesListQuery, sessionsListQueryFromPath } from '../session-list-query.js';

describe('sessionsListQueryFromPath', () => {
  it('uses all_sessions on / and /sessions/…', () => {
    expect(sessionsListQueryFromPath('/', { showArchived: false, showLoopRuns: true })).toEqual({
      include_archived: false,
      include_loop_runs: true,
      all_sessions: true,
    });
    expect(sessionsListQueryFromPath('/sessions/abc', { showArchived: true })).toMatchObject({
      include_archived: true,
      all_sessions: true,
    });
  });

  it('scopes global and repo routes', () => {
    expect(sessionsListQueryFromPath('/global', { showLoopRuns: false })).toEqual({
      include_archived: false,
      include_loop_runs: false,
      is_global: true,
    });
    expect(sessionsListQueryFromPath('/repos/12/sessions/abc')).toEqual({
      include_archived: false,
      include_loop_runs: true,
      repo_id: 12,
    });
  });
});

describe('sessionMatchesListQuery', () => {
  const repos = [
    { id: 1, full_name: 'acme/a', show_in_all_sessions: true },
    { id: 2, full_name: 'acme/hidden', show_in_all_sessions: false },
  ];

  it('hides archived and loop runs when those flags are off', () => {
    const query = { include_archived: false, include_loop_runs: false, all_sessions: true };
    expect(sessionMatchesListQuery({ id: 1, is_global: true }, query, repos)).toBe(true);
    expect(
      sessionMatchesListQuery({ id: 2, is_global: true, archived_at: 'x' }, query, repos)
    ).toBe(false);
    expect(sessionMatchesListQuery({ id: 3, is_global: true, loop_id: 9 }, query, repos)).toBe(
      false
    );
  });

  it('filters all-sessions visibility and repo / global scope', () => {
    expect(
      sessionMatchesListQuery(
        { repo_id: 2, repo_full_name: 'acme/hidden' },
        { all_sessions: true, include_archived: true, include_loop_runs: true },
        repos
      )
    ).toBe(false);
    expect(
      sessionMatchesListQuery(
        { repo_id: 1, is_global: false },
        { repo_id: 1, include_archived: true, include_loop_runs: true },
        repos
      )
    ).toBe(true);
    expect(
      sessionMatchesListQuery(
        { repo_id: 1, is_global: false },
        { is_global: true, include_archived: true, include_loop_runs: true },
        repos
      )
    ).toBe(false);
  });
});
