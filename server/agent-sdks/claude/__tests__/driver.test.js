import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = {
  setModel: vi.fn().mockResolvedValue(undefined),
  setMaxThinkingTokens: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  [Symbol.asyncIterator]: async function* () {},
};

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => mockQuery),
  tool: (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler }),
  createSdkMcpServer: vi.fn((opts) => ({ name: opts.name, tools: opts.tools })),
}));

vi.mock('../env.js', () => ({
  applyClaudeAgentModelEnv: vi.fn((env) => env),
  getClaudeEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: 'sk-ant-test' })),
}));

vi.mock('../../../services/agent-settings.js', () => ({
  getAllowedCommandsFromUser: vi.fn(() => ['ls', 'git status']),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeDriver } from '../driver.ts';
import { GenericAgentService } from '../../generic-agent-service.ts';
import {
  CLAUDE_AGENT_SDK_KEY,
  CLAUDE_AGENT_SDK_LABEL,
  CLAUDE_AGENT_SERVICE_PATH,
} from '../meta.js';

function makeApp() {
  const onUsageLimit = vi.fn().mockResolvedValue(undefined);
  const agentPatches = [];
  const db = (table) => ({
    where: () => ({
      first: async () => {
        if (table === 'agent_configs') {
          return { id: 5, user_id: 2, sdk: 'claude', api_key_encrypted: null };
        }
        return undefined;
      },
    }),
    whereIn: () => Promise.resolve([]),
  });
  return {
    onUsageLimit,
    agentPatches,
    app: {
      get: vi.fn((k) => (k === 'db' ? db : undefined)),
      service: vi.fn((name) => {
        if (name === 'sessions') {
          return {
            onUsageLimit,
            emit: vi.fn(),
            onTurnStart: vi.fn(),
            onTurnComplete: vi.fn(),
            insertUsageRow: vi.fn(),
          };
        }
        if (name === 'agents') {
          return {
            patch: vi.fn(async (id, patch) => {
              agentPatches.push({ id, patch });
              return { id, ...patch };
            }),
          };
        }
        return {
          get: vi.fn().mockResolvedValue({ id: 2 }),
          patch: vi.fn().mockResolvedValue({}),
        };
      }),
      use: vi.fn(),
      emit: vi.fn(),
    },
  };
}

describe('ClaudeDriver + GenericAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens query, maps Claude messages to ACP updates, and persists claude_session_id', async () => {
    const { app, agentPatches } = makeApp();
    const driver = new ClaudeDriver(app, { api_key: 'sk-ant-test' });
    const updates = [];
    driver.onUpdate((n) => updates.push(n.update));

    query.mockImplementationOnce(() => ({
      setModel: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-sess-42' };
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'Let me check' },
              { type: 'text', text: 'Here is the answer' },
              { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'echo hi' } },
            ],
          },
        };
        yield {
          type: 'user',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'hi', is_error: false }],
          },
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          total_cost_usd: 0.02,
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    }));

    await driver.start({
      app,
      sdk: 'claude',
      session: { id: 1, user_id: 2, session_path: null },
      agent: {
        id: 11,
        session_id: 1,
        name: 'builder',
        agent_type: 'builder',
        is_primary: 1,
        status: 'idle',
        model: 'claude-sonnet-4-6',
      },
      channel: 'chat',
      userId: 2,
      turnId: 1,
      turnModel: { model: 'claude-sonnet-4-6', modelParams: null },
      turnAgentConfigId: 5,
      cwd: '/tmp/wt',
      baguetteTools: [],
    });

    const opened = await driver.newSession({ cwd: '/tmp/wt', model: 'claude-sonnet-4-6' });
    const res = await driver.prompt(opened.sessionId, 'Say hi');

    expect(res.stopReason).toBe('end_turn');
    expect(res.usage?.total_cost_usd).toBe(0.02);
    expect(agentPatches.some((p) => p.patch.claude_session_id === 'claude-sess-42')).toBe(true);
    expect(updates.map((u) => u.sessionUpdate)).toEqual([
      'agent_thought_chunk',
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
    ]);
  });

  it('canUseTool handles ExitPlanMode, AskUserQuestion, and rejects SDK Task subagents', async () => {
    const { app } = makeApp();
    const driver = new ClaudeDriver(app, { api_key: 'sk-ant-test' });
    let capturedCanUseTool;
    query.mockImplementationOnce(({ options }) => {
      capturedCanUseTool = options.canUseTool;
      return mockQuery;
    });

    await driver.start({
      app,
      sdk: 'claude',
      session: { id: 1, user_id: 2, session_path: null },
      agent: {
        id: 11,
        session_id: 1,
        name: 'builder',
        agent_type: 'builder',
        is_primary: 1,
        status: 'idle',
        model: 'claude-sonnet-4-6',
      },
      channel: 'chat',
      userId: 2,
      turnId: 1,
      turnModel: { model: 'claude-sonnet-4-6', modelParams: null },
      turnAgentConfigId: 5,
      cwd: '/tmp/wt',
      baguetteTools: [],
    });
    await driver.newSession({ cwd: '/tmp/wt', model: 'claude-sonnet-4-6' });

    const planRes = await capturedCanUseTool('ExitPlanMode', { plan: '# Plan' });
    expect(planRes.behavior).toBe('allow');

    const askRes = await capturedCanUseTool('AskUserQuestion', {});
    expect(askRes.behavior).toBe('deny');

    const subRes = await capturedCanUseTool('Task', {});
    expect(subRes.behavior).toBe('deny');
  });

  it('isInterruptedSessionResumable and usesCompactionBeforeLoopRepeat', async () => {
    const { app } = makeApp();
    const service = new GenericAgentService({
      key: CLAUDE_AGENT_SDK_KEY,
      label: CLAUDE_AGENT_SDK_LABEL,
      servicePath: CLAUDE_AGENT_SERVICE_PATH,
      storedSessionIdColumn: 'claude_session_id',
      supportsCompactionBeforeLoopRepeat: true,
      createDriver: ({ app: svcApp, config }) => new ClaudeDriver(svcApp, config),
    });
    service.setup(app);

    expect(service.usesCompactionBeforeLoopRepeat()).toBe(true);
    await expect(
      service.isInterruptedSessionResumable(
        { id: 1, user_id: 2 },
        { agent: { claude_session_id: 'cl-1' } }
      )
    ).resolves.toBe(true);
    await expect(
      service.isInterruptedSessionResumable({ id: 1, user_id: 2 }, { agent: {} })
    ).resolves.toBe(false);
  });

  it('ignores model-less resume result and continues until real result', async () => {
    const { app } = makeApp();
    const driver = new ClaudeDriver(app, { api_key: 'sk-ant-test' });
    const updates = [];
    driver.onUpdate((n) => updates.push(n.update));

    query.mockImplementationOnce(() => ({
      setModel: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'cl-resume' };
        yield { type: 'result', subtype: 'success', is_error: false, num_turns: 0, result: '' };
        yield {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Real answer' }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          num_turns: 1,
          result: 'Real answer',
          total_cost_usd: 0.02,
        };
      },
    }));

    await driver.start({
      app,
      sdk: 'claude',
      session: { id: 1, user_id: 2 },
      agent: { id: 10, name: 'Builder', agent_type: 'builder', claude_session_id: 'cl-resume' },
      channel: 'chat',
      userId: 2,
      turnId: 1,
      turnModel: { model: 'claude-sonnet-4-6', modelParams: null },
      turnAgentConfigId: 5,
      cwd: '/tmp/wt',
      baguetteTools: [],
    });

    const opened = await driver.resume('cl-resume', { cwd: '/tmp/wt', model: 'claude-sonnet-4-6' });
    const res = await driver.prompt(opened.sessionId, 'Continue');
    expect(res.stopReason).toBe('end_turn');
    expect(res.usage?.total_cost_usd).toBe(0.02);
    expect(
      updates.some(
        (u) => u.sessionUpdate === 'agent_message_chunk' && u.content.text === 'Real answer'
      )
    ).toBe(true);
  });

  it('forwards image content blocks from payload into SDKUserMessage', async () => {
    const { app } = makeApp();
    const driver = new ClaudeDriver(app, { api_key: 'sk-ant-test' });
    let pushedPrompt = null;

    query.mockImplementationOnce(({ prompt }) => {
      pushedPrompt = prompt;
      return {
        setModel: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            num_turns: 1,
            result: 'Saw image',
          };
        },
      };
    });

    await driver.start({
      app,
      sdk: 'claude',
      session: { id: 1, user_id: 2 },
      agent: { id: 10, name: 'Builder', agent_type: 'builder' },
      channel: 'chat',
      userId: 2,
      turnId: 1,
      turnModel: { model: 'claude-sonnet-4-6', modelParams: null },
      turnAgentConfigId: 5,
      cwd: '/tmp/wt',
      baguetteTools: [],
    });

    const opened = await driver.newSession({ cwd: '/tmp/wt', model: 'claude-sonnet-4-6' });
    const imageBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    };
    await driver.prompt(opened.sessionId, 'Look at this', {
      payload: {
        type: 'user',
        content: [{ type: 'text', text: 'Look at this' }, imageBlock],
      },
    });

    const first = await pushedPrompt[Symbol.asyncIterator]().next();
    expect(first.value.message.content).toEqual([
      { type: 'text', text: 'Look at this' },
      imageBlock,
    ]);
  });

  it('checkUsageLimitGate delegates to sessions.checkUsageLimitGate', async () => {
    const checkUsageLimitGate = vi
      .fn()
      .mockResolvedValue({ reason: 'session_limit', reset_at_ms: 999 });
    const app = {
      get: vi.fn(),
      service: vi.fn(() => ({ checkUsageLimitGate })),
    };
    const driver = new ClaudeDriver(app, null);
    const gate = await driver.checkUsageLimitGate({
      app,
      session: { id: 7 },
      agent: { id: 11 },
      channel: 'chat',
      turnAgentConfigId: 5,
    });
    expect(checkUsageLimitGate).toHaveBeenCalledWith(7, 11, { agentConfigId: 5 });
    expect(gate).toEqual({ blocked: true, reason: 'session_limit', resetAtMs: 999 });
  });

  it('records usage on a usage-limit hit with partial assistant tokens', async () => {
    const insertUsageRow = vi.fn().mockResolvedValue(1);
    const onUsageLimit = vi.fn().mockResolvedValue(undefined);
    const db = (table) => ({
      select: async () => [],
      where: () => ({
        first: async () => {
          if (table === 'agents') {
            return { id: 10, agent_sdk: 'claude', agent_type: 'builder', agent_config_id: 5 };
          }
          return undefined;
        },
        increment: vi.fn().mockResolvedValue(1),
        select: async () => [],
      }),
      whereIn: () => Promise.resolve([]),
    });
    const app = {
      get: vi.fn((k) => (k === 'db' ? db : undefined)),
      service: vi.fn((name) => {
        if (name === 'sessions') {
          return { insertUsageRow, onUsageLimit };
        }
        return { get: vi.fn().mockResolvedValue({ id: 2 }), patch: vi.fn().mockResolvedValue({}) };
      }),
    };

    const driver = new ClaudeDriver(app, { api_key: 'sk-ant-test' });
    query.mockImplementationOnce(() => ({
      setModel: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            content: [{ type: 'text', text: 'Working...' }],
            usage: {
              input_tokens: 120,
              output_tokens: 30,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        };
        yield {
          type: 'rate_limit_event',
          rate_limit_info: {
            status: 'rejected',
            rateLimitType: 'five_hour',
            resetsAt: 1700000000,
          },
        };
      },
    }));

    await driver.start({
      app,
      sdk: 'claude',
      session: { id: 99, user_id: 2, usage_limit_action: 'stop' },
      agent: { id: 10, name: 'Builder', agent_type: 'builder' },
      channel: 'chat',
      userId: 2,
      turnId: 1,
      turnModel: { model: 'claude-sonnet-4-6', modelParams: null },
      turnAgentConfigId: 5,
      cwd: '/tmp/wt',
      baguetteTools: [],
    });

    const opened = await driver.newSession({ cwd: '/tmp/wt', model: 'claude-sonnet-4-6' });
    const res = await driver.prompt(opened.sessionId, 'Do work');
    expect(res.stopReason).toBe('aborted');
    expect(onUsageLimit).toHaveBeenCalledWith(
      99,
      10,
      expect.objectContaining({ sdk: 'claude', reason: 'rejected' })
    );
    expect(insertUsageRow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 99 }),
      expect.objectContaining({
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
      }),
      expect.objectContaining({ patchSessionCost: true })
    );
  });
});
