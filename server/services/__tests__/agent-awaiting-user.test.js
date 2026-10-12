import { describe, expect, it, vi } from 'vitest';
import { markAwaitingUserAfterTurnEndingTool } from '../agent-awaiting-user.js';

describe('markAwaitingUserAfterTurnEndingTool', () => {
  it('no-ops when there is no active agent session state', async () => {
    const patch = vi.fn();
    const app = {
      service: () => ({ patch }),
    };
    await markAwaitingUserAfterTurnEndingTool(app, 9, 3, null);
    expect(patch).not.toHaveBeenCalled();
  });

  it('sets endTurnAwaitingUser and patches approval for builder and review turns', async () => {
    const patch = vi.fn().mockResolvedValue({});
    const app = {
      service: () => ({ patch }),
    };
    for (const sessionState of [
      { channel: 'chat', endTurnAwaitingUser: false },
      { turnChannel: 'review', endTurnAwaitingUser: false },
    ]) {
      await markAwaitingUserAfterTurnEndingTool(app, 9, 3, sessionState);
      expect(sessionState.endTurnAwaitingUser).toBe(true);
    }
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenCalledWith(
      9,
      { status: 'approval' },
      { provider: undefined, user: { id: 3 } }
    );
  });
});
