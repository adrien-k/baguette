import { describe, it, expect } from 'vitest';
import {
  homeUrlForScope,
  isAllSessionsPath,
  isNewSessionRouteId,
  loopEditUrlForScope,
  NEW_SESSION_ROUTE_ID,
  sessionHref,
  sessionUrlForScope,
} from '../session-scope.js';

describe('isAllSessionsPath', () => {
  it('matches / and /sessions/…', () => {
    expect(isAllSessionsPath('/')).toBe(true);
    expect(isAllSessionsPath('/loop/12')).toBe(true);
    expect(isAllSessionsPath('/global/loop/12')).toBe(false);
    expect(isAllSessionsPath('/repos/1/loop/12')).toBe(false);
  });
});

describe('homeUrlForScope / sessionUrlForScope', () => {
  it('stays on All sessions', () => {
    const scope = { fromAllSessions: true, selectedRepo: '__all__', repoId: 3 };
    expect(homeUrlForScope(scope)).toBe('/');
    expect(sessionUrlForScope('abc', scope)).toBe('/sessions/abc');
    expect(loopEditUrlForScope(9, scope)).toBe('/loop/9');
  });

  it('uses Global', () => {
    const scope = { fromAllSessions: false, selectedRepo: '__global__', repoId: null };
    expect(homeUrlForScope(scope)).toBe('/global');
    expect(sessionUrlForScope('abc', scope)).toBe('/global/sessions/abc');
    expect(loopEditUrlForScope(9, scope)).toBe('/global/loop/9');
  });

  it('uses the selected repo', () => {
    const scope = { fromAllSessions: false, selectedRepo: 'acme/app', repoId: 3 };
    expect(homeUrlForScope(scope)).toBe('/repos/3');
    expect(sessionUrlForScope('abc', scope)).toBe('/repos/3/sessions/abc');
    expect(loopEditUrlForScope(9, scope)).toBe('/repos/3/loop/9');
  });
});

describe('new session route id', () => {
  it('recognizes the new-session URL segment', () => {
    expect(NEW_SESSION_ROUTE_ID).toBe('new');
    expect(isNewSessionRouteId('new')).toBe(true);
    expect(isNewSessionRouteId('abc')).toBe(false);
  });

  it('maps to scoped /sessions/new URLs', () => {
    const all = { fromAllSessions: true, selectedRepo: '__all__', repoId: 3 };
    expect(sessionUrlForScope(NEW_SESSION_ROUTE_ID, all)).toBe('/sessions/new');
    const repo = { fromAllSessions: false, selectedRepo: 'acme/app', repoId: 3 };
    expect(sessionUrlForScope(NEW_SESSION_ROUTE_ID, repo)).toBe('/repos/3/sessions/new');
  });
});

describe('sessionHref', () => {
  it('uses the unscoped path from All sessions', () => {
    expect(sessionHref({ short_id: 'abc', repo_id: 3 }, { fromAllSessions: true })).toBe(
      '/sessions/abc'
    );
    expect(sessionHref({ short_id: 'abc', is_global: true }, { fromAllSessions: true })).toBe(
      '/sessions/abc'
    );
  });

  it('uses repo or global paths otherwise', () => {
    expect(sessionHref({ short_id: 'abc', repo_id: 3 })).toBe('/repos/3/sessions/abc');
    expect(sessionHref({ short_id: 'abc', is_global: true })).toBe('/global/sessions/abc');
  });
});
