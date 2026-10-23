import { describe, it, expect } from 'vitest';
import {
  agentsScopePathFromPathname,
  homeUrlForScope,
  isAllSessionsPath,
  isLoopsPath,
  isNewSessionRouteId,
  isSessionHomePathname,
  loopEditUrlForScope,
  loopsHomeUrlForScope,
  NEW_LOOP_ROUTE_ID,
  NEW_SESSION_ROUTE_ID,
  isLoopHomePathname,
  isNewLoopRouteId,
  sessionHref,
  sessionUrlForScope,
} from '../session-scope.js';

describe('isAllSessionsPath', () => {
  it('matches / and /sessions/…', () => {
    expect(isAllSessionsPath('/')).toBe(true);
    expect(isAllSessionsPath('/loops')).toBe(true);
    expect(isAllSessionsPath('/loops/12')).toBe(true);
    expect(isAllSessionsPath('/global/loops/12')).toBe(false);
    expect(isAllSessionsPath('/repos/1/loops/12')).toBe(false);
  });
});

describe('isLoopsPath / agentsScopePathFromPathname', () => {
  it('detects loops routes and strips scope for agents', () => {
    expect(isLoopsPath('/loops')).toBe(true);
    expect(isLoopsPath('/loops/9')).toBe(true);
    expect(isLoopsPath('/global/loops')).toBe(true);
    expect(isLoopsPath('/')).toBe(false);
    expect(agentsScopePathFromPathname('/loops/9')).toBe('/');
    expect(agentsScopePathFromPathname('/global/loops')).toBe('/global');
    expect(agentsScopePathFromPathname('/repos/3/loops/9')).toBe('/repos/3');
  });
});

describe('homeUrlForScope / sessionUrlForScope', () => {
  it('stays on All sessions', () => {
    const scope = { fromAllSessions: true, selectedRepo: '__all__', repoId: 3 };
    expect(homeUrlForScope(scope)).toBe('/');
    expect(sessionUrlForScope('abc', scope)).toBe('/sessions/abc');
    expect(loopsHomeUrlForScope(scope)).toBe('/loops');
    expect(loopEditUrlForScope(9, scope)).toBe('/loops/9');
  });

  it('uses Global', () => {
    const scope = { fromAllSessions: false, selectedRepo: '__global__', repoId: null };
    expect(homeUrlForScope(scope)).toBe('/global');
    expect(sessionUrlForScope('abc', scope)).toBe('/global/sessions/abc');
    expect(loopsHomeUrlForScope(scope)).toBe('/global/loops');
    expect(loopEditUrlForScope(9, scope)).toBe('/global/loops/9');
  });

  it('uses the selected repo', () => {
    const scope = { fromAllSessions: false, selectedRepo: 'acme/app', repoId: 3 };
    expect(homeUrlForScope(scope)).toBe('/repos/3');
    expect(sessionUrlForScope('abc', scope)).toBe('/repos/3/sessions/abc');
    expect(loopsHomeUrlForScope(scope)).toBe('/repos/3/loops');
    expect(loopEditUrlForScope(9, scope)).toBe('/repos/3/loops/9');
  });
});

describe('isSessionHomePathname', () => {
  it('matches session workspace home paths only', () => {
    expect(isSessionHomePathname('/')).toBe(true);
    expect(isSessionHomePathname('/global')).toBe(true);
    expect(isSessionHomePathname('/repos/3')).toBe(true);
    expect(isSessionHomePathname('/sessions/1')).toBe(false);
    expect(isSessionHomePathname('/loops')).toBe(false);
    expect(isSessionHomePathname('/repos/3/sessions/1')).toBe(false);
  });
});

describe('loop home and new loop route', () => {
  it('matches loop workspace home paths', () => {
    expect(isLoopHomePathname('/loops')).toBe(true);
    expect(isLoopHomePathname('/global/loops')).toBe(true);
    expect(isLoopHomePathname('/repos/3/loops')).toBe(true);
    expect(isLoopHomePathname('/loops/9')).toBe(false);
  });

  it('recognizes new loop URL segment', () => {
    expect(NEW_LOOP_ROUTE_ID).toBe('new');
    expect(isNewLoopRouteId('new')).toBe(true);
    expect(
      loopEditUrlForScope('new', { fromAllSessions: true, selectedRepo: '__all__', repoId: 3 })
    ).toBe('/loops/new');
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
    expect(sessionHref({ id: 12, repo_id: 3 }, { fromAllSessions: true })).toBe('/sessions/12');
    expect(sessionHref({ id: 12, is_global: true }, { fromAllSessions: true })).toBe(
      '/sessions/12'
    );
  });

  it('uses repo or global paths otherwise', () => {
    expect(sessionHref({ id: 12, repo_id: 3 })).toBe('/repos/3/sessions/12');
    expect(sessionHref({ id: 12, is_global: true })).toBe('/global/sessions/12');
  });
});
