/**
 * _runTurn end-of-turn recovery: when a follow-up or wake-up run ends without a
 * terminal status (e.g. the SDK stream dies silently), the session must not stay
 * 'running'/'background' with queued messages that nothing will ever dispatch.
 * The turn must settle the status (unless the user stopped the turn) and let
 * onTurnComplete drain the message queue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CursorAgentService } from '../feathers/cursor-agent.service.js';

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeHarness({ sessionRow }) {
  const patches = [];
  const turnEvents = [];
  const emits = [];
  const killedAgentTasks = [];
  const dbUpdates = [];

  const sessionsSvc = {
    patch: async (id, data) => {
      patches.push(data);
      return { ...data };
    },
    onTurnStart: async (id) => turnEvents.push(['start', id]),
    onTurnComplete: async (id) => turnEvents.push(['complete', id]),
    emit: (event, payload) => emits.push({ event, payload }),
  };

  const tasksSvc = {
    watchSessionTaskNotifies: () => () => {},
    filterTasks: () => [],
    waitForTaskEvent: async () => ({ task_id: null, event: 'timeout' }),
    getTask: () => null,
    killSessionAgentTasks: (sessionId, reason) => {
      killedAgentTasks.push({ sessionId, reason });
      return 1;
    },
  };

  const db = (table) => ({
    where: () => ({
      first: async () => ({ ...sessionRow }),
      update: async (obj) => {
        dbUpdates.push({ table, obj });
        return 1;
      },
    }),
  });

  const app = {
    service: (name) => (name === 'sessions' ? sessionsSvc : name === 'tasks' ? tasksSvc : null),
    get: (name) => (name === 'db' ? db : null),
  };

  return { app, sessionsSvc, tasksSvc, patches, turnEvents, emits, killedAgentTasks, dbUpdates };
}

function stubServiceInternals(service, harness, { streamResults, pendingTaskIds }) {
  let filterCalls = 0;
  harness.tasksSvc.filterTasks = () =>
    filterCalls++ === 0 ? pendingTaskIds.map((id) => ({ id, notify_pending: true })) : [];
  service._sessionAgentOptions = vi.fn(async () => ({}));
  service.createOrResumeAgent = vi.fn(async () => ({ id: 'agent-1' }));
  service._sendWithBusyRetry = vi.fn(async () => ({ id: `run-${streamResults.length}` }));
  service._streamOneRun = vi.fn(async () => streamResults.shift());
  service._findFollowUpRun = vi.fn(async () => null);
  service._recordTurnUsage = vi.fn(async () => {});
  service._persistMessage = vi.fn(async () => {});
  service._persistStatusMessage = vi.fn(async () => {});
}

const session = { id: 9, user_id: 1, cursor_agent_id: null, plan_mode: false };
const parsed = { type: 'user', message: { role: 'user', content: 'hello' } };

describe('cursor-agent _runTurn end-of-turn recovery', () => {
  let service;

  beforeEach(() => {
    service = new CursorAgentService();
  });

  it('settles a failed wake-up follow-up and dispatches queued messages', async () => {
    const harness = makeHarness({ sessionRow: { id: 9, status: 'running' } });
    service.app = harness.app;
    stubServiceInternals(service, harness, {
      // Main run finished; the wake-up follow-up stream died without a status.
      streamResults: [
        { finishedOk: true, hasBackgroundTask: true },
        { finishedOk: false, hasBackgroundTask: false },
      ],
      pendingTaskIds: [5],
    });
    harness.tasksSvc.waitForTaskEvent = async () => ({
      task_id: 5,
      event: 'exit',
      status: 'exited',
      exit_code: 0,
    });
    harness.tasksSvc.getTask = () => ({
      toPublic: () => ({ id: 5, label: 'watch', status: 'exited' }),
      tailLogs: () => '',
    });

    await service._runTurn(session, parsed);

    // running (turn start) → background (drain wait) → running (wake-up stream) → failed.
    expect(harness.patches).toEqual([
      { status: 'running' },
      { status: 'background' },
      { status: 'running' },
      { status: 'failed' },
    ]);
    expect(service._persistStatusMessage).toHaveBeenCalledWith(
      9,
      1,
      'The turn ended unexpectedly.'
    );
    expect(harness.turnEvents).toEqual(
      expect.arrayContaining([
        ['start', 9],
        ['complete', 9],
      ])
    );
    // The turn did not finish ok: no usage recording.
    expect(service._recordTurnUsage).not.toHaveBeenCalled();
  });

  it('leaves a user-stopped turn alone and does not dispatch queued messages', async () => {
    const harness = makeHarness({ sessionRow: { id: 9, status: 'running' } });
    service.app = harness.app;
    stubServiceInternals(service, harness, {
      streamResults: [{ finishedOk: true, hasBackgroundTask: true }],
      pendingTaskIds: [5],
    });
    // The stop aborts the turn signal while the drain is waiting for a task event.
    harness.tasksSvc.waitForTaskEvent = async () => {
      service._activeSessions.get(9).abortController.abort();
      return { task_id: null, event: 'timeout' };
    };

    await service._runTurn(session, parsed);

    // No recovery patch: sessions.stop owns the 'stopped' status.
    expect(harness.patches).toEqual([{ status: 'running' }, { status: 'background' }]);
    expect(harness.turnEvents).toEqual([['start', 9]]);
    // The drain's abort path reaps the agent's tasks, matching stopTurn.
    expect(harness.killedAgentTasks).toEqual([{ sessionId: 9, reason: 'turn stopped by user' }]);
  });

  it('still completes and dispatches queued messages when every wake-up succeeds', async () => {
    const harness = makeHarness({ sessionRow: { id: 9, status: 'running' } });
    service.app = harness.app;
    stubServiceInternals(service, harness, {
      streamResults: [
        { finishedOk: true, hasBackgroundTask: true },
        { finishedOk: true, hasBackgroundTask: false },
      ],
      pendingTaskIds: [5],
    });
    harness.tasksSvc.waitForTaskEvent = async () => ({
      task_id: 5,
      event: 'exit',
      status: 'exited',
      exit_code: 0,
    });
    harness.tasksSvc.getTask = () => ({
      toPublic: () => ({ id: 5, label: 'watch', status: 'exited' }),
      tailLogs: () => '',
    });

    await service._runTurn(session, parsed);

    expect(harness.patches).toEqual([
      { status: 'running' },
      { status: 'background' },
      { status: 'running' },
      { status: 'completed' },
    ]);
    expect(harness.turnEvents).toEqual(
      expect.arrayContaining([
        ['start', 9],
        ['complete', 9],
      ])
    );
  });
});
