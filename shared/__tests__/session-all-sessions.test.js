import { describe, it, expect } from 'vitest';
import { isSessionShownInAllSessionsView } from '../session-all-sessions.js';

describe('isSessionShownInAllSessionsView', () => {
  const repos = [
    { id: 1, full_name: 'acme/a', show_in_all_sessions: true },
    { id: 2, full_name: 'acme/hidden', show_in_all_sessions: false },
  ];

  it('always shows global sessions', () => {
    expect(isSessionShownInAllSessionsView({ is_global: true }, repos)).toBe(true);
  });

  it('respects per-repo show_in_all_sessions', () => {
    expect(isSessionShownInAllSessionsView({ repo_id: 1, repo_full_name: 'acme/a' }, repos)).toBe(
      true
    );
    expect(
      isSessionShownInAllSessionsView({ repo_id: 2, repo_full_name: 'acme/hidden' }, repos)
    ).toBe(false);
  });

  it('defaults to visible when repo is unknown', () => {
    expect(isSessionShownInAllSessionsView({ repo_id: 99, repo_full_name: 'x/y' }, repos)).toBe(
      true
    );
  });
});
