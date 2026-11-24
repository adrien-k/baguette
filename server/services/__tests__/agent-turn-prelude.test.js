import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';
import { registerAllSdkPlugins } from '../../agent-sdks/index.js';
import {
  assertAgentTurnCredentials,
  NON_OWNER_MISSING_API_KEY_ERROR,
  prepareAgentTurnStart,
} from '../agent-turn-prelude.js';

registerAllSdkPlugins();

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

describe('assertAgentTurnCredentials', () => {
  const db = createTestDb();
  const app = { get: (key) => (key === 'db' ? db : undefined) };

  it('allows owners to start a turn without an api_key', async () => {
    const [ownerId] = await db('users').insert({
      github_id: 1,
      username: 'owner',
      status: 'approved',
      owner: 1,
    });
    const configId = await insertTestAgentConfig(db, ownerId, { sdk: 'claude', apiKey: null });
    await expect(
      assertAgentTurnCredentials(app, {
        userId: ownerId,
        agentSdk: 'claude',
        agentConfigId: configId,
      })
    ).resolves.toBeUndefined();
  });

  it('allows non-owners to start a turn when api_key is configured', async () => {
    const [userId] = await db('users').insert({
      github_id: 2,
      username: 'member',
      status: 'approved',
      owner: 0,
    });
    const configId = await insertTestAgentConfig(db, userId, {
      sdk: 'cursor',
      apiKey: 'cursor-secret',
    });
    await expect(
      assertAgentTurnCredentials(app, { userId, agentSdk: 'cursor', agentConfigId: configId })
    ).resolves.toBeUndefined();
  });

  it('rejects non-owners starting a claude/cursor/pi/antigravity turn without an api_key', async () => {
    const [userId] = await db('users').insert({
      github_id: 3,
      username: 'non-owner',
      status: 'approved',
      owner: 0,
    });
    for (const sdk of ['claude', 'cursor', 'pi', 'antigravity']) {
      const configId = await insertTestAgentConfig(db, userId, {
        sdk,
        label: `blank-${sdk}`,
        apiKey: null,
      });
      await expect(
        assertAgentTurnCredentials(app, { userId, agentSdk: sdk, agentConfigId: configId })
      ).rejects.toMatchObject({ name: 'Forbidden', message: NON_OWNER_MISSING_API_KEY_ERROR });
    }
  });

  it('allows non-owners to start a mock turn without an api_key', async () => {
    const [userId] = await db('users').insert({
      github_id: 4,
      username: 'mock-user',
      status: 'approved',
      owner: 0,
    });
    const configId = await insertTestAgentConfig(db, userId, { sdk: 'mock', apiKey: null });
    await expect(
      assertAgentTurnCredentials(app, { userId, agentSdk: 'mock', agentConfigId: configId })
    ).resolves.toBeUndefined();
  });
});
