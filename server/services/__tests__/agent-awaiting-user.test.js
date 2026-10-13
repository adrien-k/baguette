import { describe, expect, it, vi } from 'vitest';

vi.mock('../feathers/agents.service.js', () => ({
  patchAgentInternal: vi.fn().mockResolvedValue({}),
}));

import { patchAgentInternal } from '../feathers/agents.service.js';
import { markAwaitingUserAfterTurnEndingTool } from '../agent-awaiting-user.js';

describe('markAwaitingUserAfterTurnEndingTool', () => {
  it('no-ops when there is no active agent session state', async () => {
    const app = { service: () => ({}) };
    await markAwaitingUserAfterTurnEndingTool(app, 9, 3, null);
    expect(patchAgentInternal).not.toHaveBeenCalled();
  });

  it('sets endTurnAwaitingUser and patches agent approval for builder and review turns', async () => {
    const app = { service: () => ({}) };
    for (const sessionState of [
      { channel: 'chat', endTurnAwaitingUser: false, agentId: 42 },
      { turnChannel: 'review', endTurnAwaitingUser: false, agentId: 43 },
    ]) {
      patchAgentInternal.mockClear();
      await markAwaitingUserAfterTurnEndingTool(app, 9, 3, sessionState);
      expect(sessionState.endTurnAwaitingUser).toBe(true);
      expect(patchAgentInternal).toHaveBeenCalledTimes(1);
      expect(patchAgentInternal).toHaveBeenCalledWith(
        app,
        sessionState.agentId,
        { status: 'approval' },
        3
      );
    }
  });
});
