/**
 * stopTurn task reaping wiring: stopping a turn must always reap the agent's own
 * background tasks via tasks.killSessionAgentTasks — both when a turn is active
 * (abort + cancel + kill) and when there is no active turn (stopping an idle
 * session still clears leftover agent tasks from its last completed turn).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CursorAgentService } from '../feathers/cursor-agent.service.js';

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('cursor-agent stopTurn task reaping', () => {
  let service;
  let killed;

  beforeEach(() => {
    service = new CursorAgentService();
    killed = [];
    service.app = {
      service: () => ({
        killSessionAgentTasks: (sessionId, reason) => {
          killed.push({ sessionId, reason });
          return 1;
        },
      }),
    };
  });

  it('aborts the active run and kills agent tasks when a turn is active', async () => {
    const abort = vi.fn();
    const cancel = vi.fn();
    service._activeSessions.set(9, { abortController: { abort }, currentRun: { cancel } });

    await service.stopTurn(9);

    expect(abort).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(killed).toEqual([{ sessionId: 9, reason: 'turn stopped by user' }]);
    expect(service.getActiveSession(9)).toBeNull();
  });

  it('still kills agent tasks when no turn is active (idle session stop)', async () => {
    await service.stopTurn(9);

    expect(killed).toEqual([{ sessionId: 9, reason: 'turn stopped by user' }]);
    expect(service.getActiveSession(9)).toBeNull();
  });

  it('does not throw when the tasks service is unavailable', async () => {
    service.app = { service: () => undefined };
    await expect(service.stopTurn(9)).resolves.toBeUndefined();
    expect(service.getActiveSession(9)).toBeNull();
  });
});
