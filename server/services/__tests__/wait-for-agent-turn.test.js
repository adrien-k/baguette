import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AGENT_TURN_WAIT_TIMEOUT_MS,
  agentTurnWaitTimeoutMessage,
  waitForAgentTurnEnd,
} from '../wait-for-agent-turn.js';

vi.mock('../agents-db.js', () => ({
  getAgentById: vi.fn(),
}));

import { getAgentById } from '../agents-db.js';

describe('waitForAgentTurnEnd', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getAgentById.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns when the agent leaves running with timeoutMs null', async () => {
    getAgentById
      .mockResolvedValueOnce({ id: 1, status: 'running' })
      .mockResolvedValueOnce({ id: 1, status: 'completed' });

    const promise = waitForAgentTurnEnd({}, 1, { timeoutMs: null, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const agent = await promise;
    expect(agent.status).toBe('completed');
  });

  it('throws a steering message when timeoutMs is exceeded', async () => {
    getAgentById.mockResolvedValue({ id: 7, ref: 3, status: 'running' });

    const promise = waitForAgentTurnEnd({}, 7, { timeoutMs: 250, intervalMs: 100 });
    const assertion = expect(promise).rejects.toThrow(
      agentTurnWaitTimeoutMessage({ id: 7, ref: 3 })
    );
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
  });

  it('defaults to a one-hour wait cap', () => {
    expect(AGENT_TURN_WAIT_TIMEOUT_MS).toBe(3_600_000);
  });
});
