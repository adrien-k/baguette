import { describe, it, expect } from 'vitest';
import {
  agentsScopePathFromPathname,
  homeUrlForScope,
  isAllSessionsPath,
  isLoopsPath,
  isNewSessionRouteId,
  isSessionHomePathname,
  isSharedWithMePath,
  loopEditUrlForScope,
  loopsHomeUrlForScope,
  NEW_LOOP_ROUTE_ID,
  NEW_SESSION_ROUTE_ID,
  isLoopHomePathname,
  isNewLoopRouteId,
  isSessionWorkspacePathname,
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
    expect(isAllSessionsPath('/shared')).toBe(false);
    expect(isAllSessionsPath('/shared/sessions/1')).toBe(false);
  });
});

describe('isSharedWithMePath', () => {
  it('matches /shared and nested shared routes', () => {
    expect(isSharedWithMePath('/shared')).toBe(true);
    expect(isSharedWithMePath('/shared/sessions/1')).toBe(true);
    expect(isSharedWithMePath('/shared/loops')).toBe(true);
    expect(isSharedWithMePath('/shared/loops/12')).toBe(true);
    expect(isSharedWithMePath('/')).toBe(false);
    expect(isSharedWithMePath('/sessions/1')).toBe(false);
    expect(isSharedWithMePath('/global')).toBe(false);
  });
});

describe('isLoopsPath / agentsScopePathFromPathname', () => {
  it('detects loops routes and strips scope for agents', () => {
    expect(isLoopsPath('/loops')).toBe(true);
    expect(isLoopsPath('/loops/9')).toBe(true);
    expect(isLoopsPath('/global/loops')).toBe(true);
    expect(isLoopsPath('/shared/loops')).toBe(true);
    expect(isLoopsPath('/')).toBe(false);
    expect(agentsScopePathFromPathname('/loops/9')).toBe('/');
    expect(agentsScopePathFromPathname('/global/loops')).toBe('/global');
    expect(agentsScopePathFromPathname('/shared/loops')).toBe('/shared');
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

  it('uses Shared with me', () => {
    const scope = { fromAllSessions: false, fromSharedWithMe: true, selectedRepo: '__shared__' };
    expect(homeUrlForScope(scope)).toBe('/shared');
    expect(sessionUrlForScope('abc', scope)).toBe('/shared/sessions/abc');
    expect(loopsHomeUrlForScope(scope)).toBe('/shared/loops');
    expect(loopEditUrlForScope(9, scope)).toBe('/shared/loops/9');
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
    expect(isSessionHomePathname('/shared')).toBe(true);
    expect(isSessionHomePathname('/repos/3')).toBe(true);
    expect(isSessionHomePathname('/sessions/1')).toBe(false);
    expect(isSessionHomePathname('/loops')).toBe(false);
    expect(isSessionHomePathname('/repos/3/sessions/1')).toBe(false);
  });
});

describe('isSessionWorkspacePathname', () => {
  it('matches session and loop detail routes in every scope', () => {
    expect(isSessionWorkspacePathname('/sessions/1')).toBe(true);
    expect(isSessionWorkspacePathname('/global/sessions/1')).toBe(true);
    expect(isSessionWorkspacePathname('/shared/sessions/1')).toBe(true);
    expect(isSessionWorkspacePathname('/repos/3/sessions/1')).toBe(true);
    expect(isSessionWorkspacePathname('/loops/9')).toBe(true);
    expect(isSessionWorkspacePathname('/global/loops/9')).toBe(true);
    expect(isSessionWorkspacePathname('/shared/loops/9')).toBe(true);
    expect(isSessionWorkspacePathname('/repos/3/loops/9')).toBe(true);
  });

  it('matches the creation forms', () => {
    expect(isSessionWorkspacePathname('/sessions/new')).toBe(true);
    expect(isSessionWorkspacePathname('/global/sessions/new')).toBe(true);
    expect(isSessionWorkspacePathname('/repos/3/sessions/new')).toBe(true);
    expect(isSessionWorkspacePathname('/loops/new')).toBe(true);
    expect(isSessionWorkspacePathname('/repos/3/loops/new')).toBe(true);
  });

  it('does not match list homes or other pages', () => {
    expect(isSessionWorkspacePathname('/')).toBe(false);
    expect(isSessionWorkspacePathname('/global')).toBe(false);
    expect(isSessionWorkspacePathname('/shared')).toBe(false);
    expect(isSessionWorkspacePathname('/repos/3')).toBe(false);
    expect(isSessionWorkspacePathname('/loops')).toBe(false);
    expect(isSessionWorkspacePathname('/global/loops')).toBe(false);
    expect(isSessionWorkspacePathname('/repos/3/loops')).toBe(false);
    expect(isSessionWorkspacePathname('/sessions/1/description')).toBe(false);
    expect(isSessionWorkspacePathname('/session/1/description')).toBe(false);
    expect(isSessionWorkspacePathname('/settings')).toBe(false);
    expect(isSessionWorkspacePathname('/usage')).toBe(false);
  });
});

describe('loop home and new loop route', () => {
  it('matches loop workspace home paths', () => {
    expect(isLoopHomePathname('/loops')).toBe(true);
    expect(isLoopHomePathname('/global/loops')).toBe(true);
    expect(isLoopHomePathname('/shared/loops')).toBe(true);
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
