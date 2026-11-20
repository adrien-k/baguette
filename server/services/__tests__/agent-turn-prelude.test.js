import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareAgentTurnStart } from '../agent-turn-prelude.js';

const compactionMock = vi.fn();
const chatPromptMock = vi.fn();

vi.mock('../agent-turn-compaction.js', () => ({
  prepareAgentTurnCompaction: (...args) => compactionMock(...args),
}));

vi.mock('../ensure-agent-system-prompt-message.js', () => ({
  ensureAgentChatSystemPromptMessage: (...args) => chatPromptMock(...args),
}));

describe('prepareAgentTurnStart', () => {
  const app = {};
  const session = { id: 1 };
  const agent = { id: 2, agent_sdk: 'claude' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('compacts and persists chat prompt for builder turns', async () => {
    await prepareAgentTurnStart(app, session, agent, { channel: 'chat', agentSdk: 'claude' });
    expect(compactionMock).toHaveBeenCalledWith(app, session);
    expect(chatPromptMock).toHaveBeenCalledWith(app, session, agent, 'claude');
  });

  it('skips chat prompt on review channel', async () => {
    await prepareAgentTurnStart(app, session, agent, { channel: 'review' });
    expect(compactionMock).toHaveBeenCalled();
    expect(chatPromptMock).not.toHaveBeenCalled();
  });
});
