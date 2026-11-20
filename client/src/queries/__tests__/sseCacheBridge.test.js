// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const makeService = () => {
    const listeners = [];
    const api = {
      on: (event, listener) => listeners.push({ event, listener }),
      off: (event, listener) => {
        const index = listeners.findIndex((l) => l.event === event && l.listener === listener);
        if (index !== -1) listeners.splice(index, 1);
      },
      emit: (event, payload) => {
        for (const l of [...listeners]) {
          if (l.event === event) l.listener(payload);
        }
      },
      listeners,
    };
    return api;
  };
  return {
    sessionsService: makeService(),
    agentsService: makeService(),
    messagesService: makeService(),
    reposService: makeService(),
    tasksService: makeService(),
    sessionIssuesService: makeService(),
    usersService: makeService(),
    loopsService: makeService(),
    sessionPlansService: makeService(),
    sessionTodosService: makeService(),
    agentModelPresetsService: makeService(),
  };
});

vi.mock('../../feathers.js', () => ({
  sessionsService: mocks.sessionsService,
  agentsService: mocks.agentsService,
  messagesService: mocks.messagesService,
  reposService: mocks.reposService,
  tasksService: mocks.tasksService,
  sessionIssuesService: mocks.sessionIssuesService,
  usersService: mocks.usersService,
  loopsService: mocks.loopsService,
  sessionPlansService: mocks.sessionPlansService,
  sessionTodosService: mocks.sessionTodosService,
  agentModelPresetsService: mocks.agentModelPresetsService,
}));

import { QueryClient } from '@tanstack/react-query';
import { startSseCacheBridge } from '../sseCacheBridge.js';
import { resyncActiveQueriesFromServer, resetReconnectResyncForTests } from '../reconnectResync.js';
import { setRealtimeScope } from '../realtimeScope.js';
import { sessionKeys, sessionIssueKeys, loopKeys, agentModelPresetKeys } from '../keys.js';

let queryClient;
let stopBridge;

beforeEach(() => {
  queryClient = new QueryClient();
  stopBridge = startSseCacheBridge(queryClient);
});

afterEach(() => {
  stopBridge();
  resetReconnectResyncForTests();
  setRealtimeScope({ repos: [], currentUserId: null });
  queryClient.clear();
});

const listQuery = { include_archived: true };
const scope = {
  repos: [{ id: 1, full_name: 'acme/a', show_in_all_sessions: true }],
  currentUserId: 7,
};
const owned = {
  id: 10,
  user_id: 7,
  repo_id: 1,
  repo_full_name: 'acme/a',
  status: 'running',
};

function seedList(rows) {
  queryClient.setQueryData(sessionKeys.list(listQuery), {
    pages: [{ data: rows, total: rows.length }],
    pageParams: [0],
  });
}

function seedDetail(session) {
  queryClient.setQueryData(sessionKeys.detail(session.id), session);
}

function readList() {
  return queryClient.getQueryData(sessionKeys.list(listQuery));
}

describe('sseCacheBridge', () => {
  it('merges session patches into lists and details', () => {
    setRealtimeScope(scope);
    seedList([owned]);
    seedDetail(owned);

    mocks.sessionsService.emit('patched', { id: 10, status: 'completed' });

    expect(readList().pages[0].data[0]).toMatchObject({ id: 10, status: 'completed' });
    expect(queryClient.getQueryData(sessionKeys.detail(10))).toMatchObject({
      id: 10,
      status: 'completed',
    });
  });

  it('respects the list query filter when inserting', () => {
    setRealtimeScope(scope);
    const repoListKey = sessionKeys.list({ repo_id: 1 });
    queryClient.setQueryData(repoListKey, {
      pages: [{ data: [owned], total: 1 }],
      pageParams: [0],
    });

    mocks.sessionsService.emit('created', { ...owned, id: 11, repo_id: 2 });
    expect(queryClient.getQueryData(repoListKey).pages[0].data).toHaveLength(1);

    mocks.sessionsService.emit('created', { ...owned, id: 12, repo_id: 1 });
    expect(queryClient.getQueryData(repoListKey).pages[0].data).toHaveLength(2);
  });

  it('drops detail and counts queries when a session is removed', () => {
    setRealtimeScope(scope);
    seedList([owned]);
    seedDetail(owned);
    queryClient.setQueryData(sessionKeys.counts(10), { open_issues_count: 1 });

    mocks.sessionsService.emit('removed', owned);

    expect(readList().pages[0].data).toEqual([]);
    expect(queryClient.getQueryData(sessionKeys.detail(10))).toBeUndefined();
    expect(queryClient.getQueryData(sessionKeys.counts(10))).toBeUndefined();
  });

  it('applies agent patches to lists and details', () => {
    setRealtimeScope(scope);
    seedList([{ ...owned, agents: [{ id: 5, ref: 1, status: 'idle' }] }]);
    seedDetail({ ...owned, agents: [{ id: 5, ref: 1, status: 'idle' }] });

    mocks.agentsService.emit('patched', {
      session_id: 10,
      id: 5,
      ref: 1,
      status: 'running',
    });

    expect(readList().pages[0].data[0].agents[0].status).toBe('running');
    expect(queryClient.getQueryData(sessionKeys.detail(10)).agents[0].status).toBe('running');
  });

  it('inserts messages into matching message entries only', () => {
    const allAgentsKey = ['messages', '10', null];
    const agentScopedKey = ['messages', '10', '2'];
    queryClient.setQueryData(allAgentsKey, {
      pages: [[{ id: 1, session_id: 10, agent_id: 2 }]],
      pageParams: [null],
    });
    queryClient.setQueryData(agentScopedKey, {
      pages: [[{ id: 1, session_id: 10, agent_id: 2 }]],
      pageParams: [null],
    });

    mocks.messagesService.emit('created', { id: 2, session_id: 10, agent_id: 2 });

    expect(queryClient.getQueryData(allAgentsKey).pages[0]).toHaveLength(2);
    expect(queryClient.getQueryData(agentScopedKey).pages[0]).toHaveLength(2);
  });

  it('does not insert other agents messages into agent-scoped entries', () => {
    const agentScopedKey = ['messages', '10', '2'];
    queryClient.setQueryData(agentScopedKey, {
      pages: [[{ id: 1, session_id: 10, agent_id: 2 }]],
      pageParams: [null],
    });

    mocks.messagesService.emit('created', { id: 2, session_id: 10, agent_id: 3 });

    expect(queryClient.getQueryData(agentScopedKey).pages[0]).toHaveLength(1);
  });

  it('holds message events until an in-flight reconnect reload finishes', async () => {
    const allAgentsKey = ['messages', '10', null];
    queryClient.setQueryData(allAgentsKey, {
      pages: [[{ id: 1, session_id: 10, agent_id: 2 }]],
      pageParams: [null],
    });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    queryClient.invalidateQueries = () => gate;

    const pending = resyncActiveQueriesFromServer(queryClient);
    mocks.messagesService.emit('created', { id: 2, session_id: 10, agent_id: 2 });
    expect(queryClient.getQueryData(allAgentsKey).pages[0]).toHaveLength(1);

    release();
    await pending;
    expect(queryClient.getQueryData(allAgentsKey).pages[0]).toHaveLength(2);
  });

  it('invalidates session counts when tasks or issues change', () => {
    queryClient.setQueryData(sessionKeys.counts(10), { open_issues_count: 0 });
    expect(queryClient.getQueryState(sessionKeys.counts(10)).isInvalidated).toBe(false);

    mocks.tasksService.emit('created', { id: 1, session_id: 10 });
    expect(queryClient.getQueryState(sessionKeys.counts(10)).isInvalidated).toBe(true);

    mocks.sessionIssuesService.emit('patched', { id: 2, session_id: 10 });
    expect(queryClient.getQueryState(sessionKeys.counts(10)).isInvalidated).toBe(true);

    // Rows without a session must not invalidate anything.
    queryClient.refetchQueries({ queryKey: sessionKeys.counts(10) });
    mocks.sessionIssuesService.emit('created', { id: 3, session_id: null });
    mocks.tasksService.emit('patched', { id: 4 });
  });

  it('merges issue events into matching session entries only', () => {
    const issueKey = sessionIssueKeys.session(10);
    queryClient.setQueryData(issueKey, [
      { id: 1, session_id: 10, severity: 'high', status: 'opened' },
    ]);

    mocks.sessionIssuesService.emit('created', {
      id: 2,
      session_id: 10,
      severity: 'low',
      status: 'opened',
    });
    expect(queryClient.getQueryData(issueKey)).toHaveLength(2);

    // Closed patches drop the row.
    mocks.sessionIssuesService.emit('patched', { id: 2, session_id: 10, status: 'closed' });
    expect(queryClient.getQueryData(issueKey)).toHaveLength(1);

    // Other sessions' issues do not land here.
    mocks.sessionIssuesService.emit('created', {
      id: 3,
      session_id: 11,
      severity: 'low',
      status: 'opened',
    });
    expect(queryClient.getQueryData(issueKey)).toHaveLength(1);

    mocks.sessionIssuesService.emit('removed', { id: 1, session_id: 10 });
    expect(queryClient.getQueryData(issueKey)).toEqual([]);
  });

  it('invalidates loops entries on any loop change', () => {
    queryClient.setQueryData(loopKeys.all, [{ id: 1 }]);
    expect(queryClient.getQueryState(loopKeys.all).isInvalidated).toBe(false);

    mocks.loopsService.emit('created', { id: 1 });
    expect(queryClient.getQueryState(loopKeys.all).isInvalidated).toBe(true);
  });

  it('upserts and removes preset rows in the cached list', () => {
    const preset = { id: 5, description: 'A', enabled: true };
    queryClient.setQueryData(agentModelPresetKeys.list(), [preset]);

    mocks.agentModelPresetsService.emit('patched', {
      ...preset,
      description: 'A2',
      enabled: false,
    });
    expect(queryClient.getQueryData(agentModelPresetKeys.list())).toEqual([
      { id: 5, description: 'A2', enabled: false },
    ]);

    mocks.agentModelPresetsService.emit('created', { id: 6, description: 'B', enabled: true });
    expect(queryClient.getQueryData(agentModelPresetKeys.list()).map((row) => row.id)).toEqual([
      5, 6,
    ]);

    mocks.agentModelPresetsService.emit('removed', { id: 5 });
    expect(queryClient.getQueryData(agentModelPresetKeys.list()).map((row) => row.id)).toEqual([6]);
  });
});
