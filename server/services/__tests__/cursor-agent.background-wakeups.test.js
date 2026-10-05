/**
 * Wake-up follow-up loop for baguette-monitored background tasks (Cursor sessions).
 * drainBackgroundTaskWakeups is pure orchestration with injectable dependencies, so
 * these tests stub the tasks service, persistence, and follow-up sends.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  drainBackgroundTaskWakeups,
  buildTaskWakeText,
  describeTaskWakeStatus,
  taskNotificationStatus,
  taskNotificationPayload,
  BACKGROUND_WAKE_MAX_FOLLOW_UPS,
  BACKGROUND_WAKE_MAX_SILENT_CYCLES,
} from '../feathers/cursor-agent.service.js';

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const monitored = (id, label = null) => ({ id, label, status: 'running' });

function makeDeps({ pendingQueue, events, sendResults = [], task = null }) {
  const notifications = [];
  const sentTexts = [];
  const killedIds = [];
  const statuses = [];
  let call = 0;
  const deps = {
    listMonitoredPending: () => pendingQueue[Math.min(call, pendingQueue.length - 1)] ?? [],
    waitForEvent: async () => events[Math.min(call, events.length - 1)],
    getTask: (id) => (id ? (task ?? monitored(id, 'demo task')) : null),
    persistNotification: async (payload) => notifications.push(payload),
    sendFollowUp: async (text) => {
      sentTexts.push(text);
      return sendResults[call] ?? true;
    },
    killTask: async (id, opts) => {
      killedIds.push({ id, ...opts });
      return true;
    },
    setStatus: async (status) => statuses.push(status),
    signal: null,
  };
  return { deps, notifications, sentTexts, killedIds, statuses, increment: () => call++ };
}

/** Wraps sendFollowUp so the call counter advances after each follow-up. */
function withCountingSend({ deps, increment }) {
  const origSend = deps.sendFollowUp;
  return {
    ...deps,
    sendFollowUp: async (text) => {
      const ok = await origSend(text);
      increment();
      return ok;
    },
  };
}

describe('drainBackgroundTaskWakeups', () => {
  it('returns drained immediately when nothing is pending', async () => {
    const { deps, sentTexts, notifications, statuses } = makeDeps({
      pendingQueue: [[]],
      events: [],
    });
    const result = await drainBackgroundTaskWakeups(deps);
    expect(result).toBe('drained');
    expect(sentTexts).toHaveLength(0);
    expect(notifications).toHaveLength(0);
    expect(statuses).toHaveLength(0);
  });

  it('marks background, delivers a wake-up, and drains', async () => {
    const { deps, sentTexts, notifications, statuses, increment } = makeDeps({
      pendingQueue: [[monitored(11)], []],
      events: [
        {
          task_id: 11,
          event: 'pattern',
          status: 'running',
          matched_line: 'Build complete',
        },
      ],
      task: { id: 11, label: 'build', status: 'running', output_tail: 'Build complete in 1.2s\n' },
    });
    const result = await drainBackgroundTaskWakeups(withCountingSend({ deps, increment }));
    expect(result).toBe('drained');
    // Session went background while waiting, running again when the follow-up streamed.
    expect(statuses).toEqual(['background', 'running']);
    // Task-event notifications are recorded at event time by the turn's notify
    // watcher; the drain loop itself persists only the wake_limit notice.
    expect(notifications).toHaveLength(0);
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]).toContain('task #11');
    expect(sentTexts[0]).toContain('(build)');
    expect(sentTexts[0]).toContain('Build complete');
    expect(sentTexts[0]).toContain('Continue your work');
  });

  it('reports send_failed when the follow-up run does not finish ok', async () => {
    const { deps, increment } = makeDeps({
      pendingQueue: [[monitored(12)]],
      events: [{ task_id: 12, event: 'exit', status: 'exited', exit_code: 0 }],
      sendResults: [false],
    });
    const result = await drainBackgroundTaskWakeups(withCountingSend({ deps, increment }));
    expect(result).toBe('send_failed');
  });

  it('returns aborted without waiting when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, sentTexts, statuses } = makeDeps({
      pendingQueue: [[monitored(13)]],
      events: [],
    });
    const result = await drainBackgroundTaskWakeups({ ...deps, signal: controller.signal });
    expect(result).toBe('aborted');
    expect(sentTexts).toHaveLength(0);
    expect(statuses).toHaveLength(0);
  });

  it('returns aborted when the signal fires during the wait', async () => {
    const controller = new AbortController();
    const { deps, sentTexts } = makeDeps({ pendingQueue: [[monitored(14)]], events: [] });
    const wrapped = {
      ...deps,
      waitForEvent: async () => {
        controller.abort();
        return { task_id: null, event: 'timeout', status: null, matched_line: null };
      },
    };
    const result = await drainBackgroundTaskWakeups({ ...wrapped, signal: controller.signal });
    expect(result).toBe('aborted');
    expect(sentTexts).toHaveLength(0);
  });

  it('cancels remaining monitored tasks when the wake-up limit is reached', async () => {
    const { deps, killedIds, notifications, sentTexts, increment } = makeDeps({
      pendingQueue: [[monitored(15)]],
      events: [
        { task_id: 15, event: 'exit', status: 'exited', exit_code: 0 },
        { task_id: 15, event: 'exit', status: 'exited', exit_code: 0 },
      ],
      sendResults: [true, true],
    });
    const result = await drainBackgroundTaskWakeups({
      ...withCountingSend({ deps, increment }),
      maxFollowUps: 1,
    });
    expect(result).toBe('drained');
    expect(sentTexts).toHaveLength(1);
    // Only the wake_limit notice — task-event notifications are recorded elsewhere.
    expect(notifications).toHaveLength(1);
    const limitNotification = notifications.at(-1);
    expect(limitNotification).toMatchObject({
      subtype: 'task_notification',
      event: 'wake_limit',
      status: 'cancelled',
    });
    expect(killedIds).toEqual([{ id: 15, reason: 'wake-up limit reached' }]);
  });

  it('defaults the follow-up cap to 10', () => {
    expect(BACKGROUND_WAKE_MAX_FOLLOW_UPS).toBe(10);
  });

  it('keeps waiting through wait timeouts without waking the agent', async () => {
    // Two wait timeouts must not wake the agent or consume follow-up slots; only the
    // eventual real event does. Status stays 'background' during the silent waits.
    const pending = [monitored(21)];
    const statuses = [];
    const sentTexts = [];
    const notifications = [];
    let eventIdx = 0;
    let sends = 0;
    const deps = {
      listMonitoredPending: () => (sends > 0 ? [] : pending),
      waitForEvent: async () => {
        eventIdx += 1;
        if (eventIdx <= 2) return { task_id: null, event: 'timeout', status: null };
        return { task_id: 21, event: 'pattern', status: 'running', matched_line: 'Ready' };
      },
      getTask: (id) =>
        id ? { id, label: 'build', status: 'running', output_tail: 'Ready' } : null,
      persistNotification: async (payload) => notifications.push(payload),
      sendFollowUp: async (text) => {
        sends += 1;
        sentTexts.push(text);
        return true;
      },
      killTask: async () => true,
      setStatus: async (status) => statuses.push(status),
      signal: null,
    };
    const result = await drainBackgroundTaskWakeups(deps);
    expect(result).toBe('drained');
    expect(sentTexts).toHaveLength(1);
    expect(statuses).toEqual(['background', 'background', 'background', 'running']);
    expect(notifications).toHaveLength(0);
  });

  it('gives up with a wake_limit notice after the silence budget is spent', async () => {
    const pending = [monitored(22)];
    const statuses = [];
    const sentTexts = [];
    const notifications = [];
    const killedIds = [];
    const deps = {
      listMonitoredPending: () => pending,
      waitForEvent: async () => ({ task_id: null, event: 'timeout', status: null }),
      getTask: () => null,
      persistNotification: async (payload) => notifications.push(payload),
      sendFollowUp: async (text) => sentTexts.push(text),
      killTask: async (id, opts) => {
        killedIds.push({ id, ...opts });
        return true;
      },
      setStatus: async (status) => statuses.push(status),
      signal: null,
    };
    const result = await drainBackgroundTaskWakeups({ ...deps, maxSilentCycles: 2 });
    expect(result).toBe('drained');
    // The agent is never woken for silence — the turn just ends.
    expect(sentTexts).toHaveLength(0);
    expect(statuses).toEqual(['background', 'background']);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      subtype: 'task_notification',
      event: 'wake_limit',
      status: 'cancelled',
      task_ids: [22],
    });
    expect(killedIds).toEqual([{ id: 22, reason: 'wake-up limit reached' }]);
  });

  it('resets the silence budget after a real wake-up', async () => {
    // timeout, pattern, timeout, timeout, pattern with maxSilentCycles 3: the second
    // run of consecutive timeouts must not trip the limit just because an earlier
    // timeout happened before the first wake-up.
    const pending = [monitored(23)];
    const sentTexts = [];
    const notifications = [];
    const seq = [
      { task_id: null, event: 'timeout', status: null },
      { task_id: 23, event: 'pattern', status: 'running', matched_line: 'ping 1' },
      { task_id: null, event: 'timeout', status: null },
      { task_id: null, event: 'timeout', status: null },
      { task_id: 23, event: 'pattern', status: 'running', matched_line: 'ping 2' },
    ];
    let eventIdx = 0;
    let sends = 0;
    const deps = {
      listMonitoredPending: () => (sends >= 2 ? [] : pending),
      waitForEvent: async () => {
        const event = seq[Math.min(eventIdx, seq.length - 1)];
        eventIdx += 1;
        return event;
      },
      getTask: (id) => (id ? { id, label: 'watch', status: 'running', output_tail: 'ping' } : null),
      persistNotification: async (payload) => notifications.push(payload),
      sendFollowUp: async (text) => {
        sends += 1;
        sentTexts.push(text);
        return true;
      },
      killTask: async () => true,
      setStatus: async () => {},
      signal: null,
    };
    const result = await drainBackgroundTaskWakeups({ ...deps, maxSilentCycles: 3 });
    expect(result).toBe('drained');
    expect(sentTexts).toHaveLength(2);
    expect(sentTexts[0]).toContain('ping 1');
    expect(sentTexts[1]).toContain('ping 2');
    expect(notifications).toHaveLength(0);
  });

  it('defaults the silence budget to 6 cycles (~1h of 10-minute waits)', () => {
    expect(BACKGROUND_WAKE_MAX_SILENT_CYCLES).toBe(6);
  });
});

describe('taskNotificationStatus', () => {
  it('maps exit events to claude-compatible statuses', () => {
    expect(taskNotificationStatus({ event: 'pattern' })).toBe('running');
    expect(taskNotificationStatus({ event: 'exit', status: 'exited', exit_code: 0 })).toBe(
      'completed'
    );
    expect(taskNotificationStatus({ event: 'exit', status: 'exited', exit_code: 3 })).toBe(
      'failed'
    );
    expect(taskNotificationStatus({ event: 'exit', status: 'stopped', exit_code: 0 })).toBe(
      'cancelled'
    );
  });
});

describe('taskNotificationPayload', () => {
  it('builds a claude-shaped task_notification row at event time', () => {
    const payload = taskNotificationPayload(
      { task_id: 31, event: 'pattern', status: 'running', matched_line: 'Build complete' },
      { id: 31, status: 'running', tailLogs: () => 'Build complete in 1.2s\n' }
    );
    expect(payload).toMatchObject({
      type: 'system',
      subtype: 'task_notification',
      task_id: 31,
      event: 'pattern',
      status: 'running',
      matched_line: 'Build complete',
      output_tail: 'Build complete in 1.2s\n',
      ambient: false,
    });
    expect(payload.uuid).toEqual(expect.any(String));
  });

  it('maps exit events and tolerates a missing task', () => {
    const payload = taskNotificationPayload(
      { task_id: 32, event: 'exit', status: 'exited', exit_code: 2 },
      null
    );
    expect(payload).toMatchObject({
      type: 'system',
      subtype: 'task_notification',
      task_id: 32,
      event: 'exit',
      status: 'failed',
      matched_line: null,
      output_tail: null,
      ambient: false,
    });
  });
});

describe('buildTaskWakeText', () => {
  it('includes the label, matched line, output tail, and status', () => {
    const text = buildTaskWakeText({
      event: {
        task_id: 21,
        event: 'pattern',
        status: 'running',
        matched_line: 'Tests passed',
      },
      task: {
        id: 21,
        label: 'run tests',
        status: 'running',
        output_tail: 'Tests passed\nAll good\n',
      },
    });
    expect(text).toContain('task #21');
    expect(text).toContain('(run tests)');
    expect(text).toContain('reported a pattern match');
    expect(text).toContain('Matched line: Tests passed');
    expect(text).toContain('Tests passed\nAll good');
    expect(text).toContain('TaskStatus');
  });

  it('falls back to the command when there is no label', () => {
    const text = buildTaskWakeText({
      event: { task_id: 22, event: 'exit', status: 'exited', exit_code: 2 },
      task: { id: 22, label: null, command: 'make world', status: 'exited' },
    });
    expect(text).toContain('(make world)');
    expect(text).toContain('exited with code 2');
  });

  it('describes task statuses', () => {
    expect(describeTaskWakeStatus({ event: 'exit', status: 'exited', exit_code: 0 })).toContain(
      'exited successfully'
    );
    expect(describeTaskWakeStatus({ event: 'exit', status: 'exited', exit_code: 3 })).toContain(
      'code 3'
    );
    expect(describeTaskWakeStatus({ event: 'exit', status: 'stopped' })).toContain('cancelled');
    expect(describeTaskWakeStatus({ event: 'timeout' })).toContain('timed out');
  });
});
