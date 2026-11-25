import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { insertSessionWithPrimaryBuilder } from '../../test-utils/session-agents.js';
import { GenericAgentService } from '../../agent-sdks/generic-agent-service.ts';
import { registerSdkPlugin } from '../../agent-sdks/registry.js';
import { acpToolCallBuilders } from '../../agent-sdks/acp-mapping.ts';

registerSdkPlugin({
  key: 'test-awaiting',
  label: 'TestAwaiting',
  servicePath: 'test-awaiting-agent',
  ownerOnlySystemAuth: false,
  toolCallBuilders: acpToolCallBuilders,
});

describe('turn end after CreatePlan / AskUserQuestions', () => {
  const db = createTestDb();
  let agentPatch;
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    agentPatch = vi.fn().mockResolvedValue({});
    await db('users').insert({ github_id: 1, username: 'u', owner: 1 });
    await db('agent_configs').insert({ id: 5, user_id: 1, sdk: 'test-awaiting', label: 'Test' });
    await insertSessionWithPrimaryBuilder(db, {
      id: 1,
      user_id: 1,
      repo_full_name: 'local/repo',
      base_branch: 'main',
      short_id: 'ta1',
      initial_prompt: 'hi',
      agent_sdk: 'test-awaiting',
      model: 'test-model',
      status: 'idle',
      agent_config_id: 5,
    });
    app = {
      get: (k) => (k === 'db' ? db : undefined),
      service: (name) => {
        if (name === 'agents') return { patch: agentPatch };
        if (name === 'messages') {
          return {
            create: vi.fn(async (data) => ({ id: 1, ...data })),
            patch: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === 'sessions') {
          return {
            onTurnStart: vi.fn().mockResolvedValue(undefined),
            onTurnComplete: vi.fn().mockResolvedValue(undefined),
            insertUsageRow: vi.fn().mockResolvedValue(1),
            emit: vi.fn(),
          };
        }
        return {};
      },
      use: vi.fn(),
      emit: vi.fn(),
    };
  });

  it('records usage, sets approval status, and skips completed patch when awaiting user', async () => {
    const recordTurnUsage = vi.fn().mockResolvedValue(undefined);
    const service = new GenericAgentService({
      key: 'test-awaiting',
      label: 'TestAwaiting',
      servicePath: 'test-awaiting-agent',
      createDriver: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        newSession: vi.fn().mockResolvedValue({ sessionId: 'drv-1' }),
        resume: vi.fn().mockResolvedValue({ sessionId: 'drv-1' }),
        prompt: vi.fn().mockResolvedValue({
          stopReason: 'end_turn',
          awaitingUser: true,
          usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
        }),
        onUpdate: () => () => {},
        cancel: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        recordTurnUsage,
      }),
    });
    service.setup(app);

    const session = await db('sessions').where({ id: 1 }).first();
    const builder = await db('agents').where({ session_id: 1, is_primary: 1 }).first();
    await service._runTurn(
      session,
      { type: 'user', subtype: 'human', message: { role: 'user', content: 'hi' } },
      { model: 'test-model', model_params: null, agent_config_id: 5 },
      { turnId: 10, channel: 'chat', agent: builder }
    );

    expect(recordTurnUsage).toHaveBeenCalled();
    const completedPatch = agentPatch.mock.calls.find(([, data]) => data?.status === 'completed');
    expect(completedPatch).toBeUndefined();
    const approvalPatch = agentPatch.mock.calls.find(([, data]) => data?.status === 'approval');
    expect(approvalPatch).toBeTruthy();
  });
});
