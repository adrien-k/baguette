import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPiSession = {
  sessionId: 'pi-sess-1',
  isStreaming: false,
  prompt: vi.fn().mockResolvedValue(undefined),
  steer: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  setModel: vi.fn().mockResolvedValue(undefined),
  bindExtensions: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(() => () => {}),
};

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createAgentSession: vi.fn(async () => ({ session: mockPiSession, extensionsResult: {} })),
    SessionManager: {
      create: vi.fn(() => ({ getCwd: () => '/tmp' })),
      findById: vi.fn(),
      open: vi.fn(),
      inMemory: vi.fn(() => ({ getCwd: () => '/tmp' })),
    },
    SettingsManager: {
      create: vi.fn(() => ({})),
    },
    DefaultResourceLoader: class {
      reload() {
        return Promise.resolve();
      }
    },
    resolveCliModel: vi.fn(() => ({ model: { id: 'test-model' }, error: undefined })),
  };
});

vi.mock('../models.js', () => ({
  createPiModelRuntime: vi.fn().mockResolvedValue({}),
  resolvePiSessionModel: vi
    .fn()
    .mockResolvedValue({ model: { id: 'test-model' }, thinkingLevel: 'off' }),
}));

vi.mock('../adapt-tools.js', () => ({
  toolListToPiCustomTools: vi.fn(() => []),
}));

import { PiDriver } from '../driver.ts';
import { GenericAgentService } from '../../generic-agent-service.ts';
import { PI_AGENT_SDK_KEY, PI_AGENT_SDK_LABEL, PI_AGENT_SERVICE_PATH } from '../meta.js';
import { createAgentSession } from '@earendil-works/pi-coding-agent';

function makeApp(overrides = {}) {
  const db = (_table) => ({
    where: () => ({
      first: async () => ({
        id: 1,
        session_id: 1,
        agent_type: 'builder',
        user_id: 2,
        agent_sdk: 'pi',
        model: 'claude-haiku-4-5',
        session_path: 'sessions/wt',
        status: 'idle',
        ...overrides.session,
      }),
      update: vi.fn().mockResolvedValue(1),
    }),
  });
  return {
    get: vi.fn((key) => (key === 'db' ? db : undefined)),
    service: vi.fn(() => ({
      patch: vi.fn().mockResolvedValue({}),
      onTurnStart: vi.fn().mockResolvedValue(undefined),
      onTurnComplete: vi.fn().mockResolvedValue(undefined),
      insertUsageRow: vi.fn().mockResolvedValue(1),
      emit: vi.fn(),
      hooks: vi.fn(),
    })),
    use: vi.fn(),
    emit: vi.fn(),
  };
}

describe('PiDriver + GenericAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPiSession.isStreaming = false;
    mockPiSession.subscribe.mockImplementation(() => () => {});
  });

  it('starts session, translates Pi events into ACP updates, and finishes turn', async () => {
    const app = makeApp();
    const driver = new PiDriver(app, {
      api_key: 'sk-ant-test',
      api_key_env_var: 'ANTHROPIC_API_KEY',
    });
    const updates = [];
    driver.onUpdate((n) => updates.push(n.update));

    mockPiSession.subscribe.mockImplementation((cb) => {
      setTimeout(() => {
        cb({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hi!' } });
        cb({
          type: 'tool_execution_start',
          toolCallId: 'tc-1',
          toolName: 'bash',
          args: { command: 'ls' },
        });
        cb({
          type: 'tool_execution_end',
          toolCallId: 'tc-1',
          toolName: 'bash',
          args: { command: 'ls' },
          result: { structuredContent: { output: 'file.txt', exit_code: 0 } },
          isError: false,
        });
        cb({
          type: 'turn_end',
          message: {
            role: 'assistant',
            model: 'claude-haiku-4-5',
            usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
          },
        });
      }, 0);
      return () => {};
    });

    mockPiSession.prompt.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10))
    );

    await driver.start({
      app,
      sdk: 'pi',
      session: { id: 1, user_id: 2, session_path: '/tmp/wt' },
      agent: {
        id: 1,
        session_id: 1,
        name: 'builder',
        agent_type: 'builder',
        is_primary: 1,
        status: 'idle',
      },
      channel: 'chat',
      userId: 2,
      turnId: 1,
      turnModel: { model: 'claude-haiku-4-5', modelParams: null },
      turnAgentConfigId: 5,
      cwd: '/tmp/wt',
      baguetteTools: [],
    });

    const opened = await driver.newSession({ cwd: '/tmp/wt', model: 'claude-haiku-4-5' });
    expect(createAgentSession).toHaveBeenCalled();
    expect(opened.sessionId).toBe('pi-sess-1');

    const res = await driver.prompt(opened.sessionId, 'Hello');
    expect(res.stopReason).toBe('end_turn');
    expect(res.usage?.input_tokens).toBe(10);
    expect(res.usage?.output_tokens).toBe(5);
    expect(updates.map((u) => u.sessionUpdate)).toEqual([
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
    ]);
  });

  it('steers active streaming session when row.force is true', async () => {
    const app = makeApp();
    const driver = new PiDriver(app, {
      api_key: 'sk-ant-test',
      api_key_env_var: 'ANTHROPIC_API_KEY',
    });
    await driver.start({
      app,
      sdk: 'pi',
      session: { id: 1, user_id: 2, session_path: '/tmp/wt' },
      agent: {
        id: 1,
        session_id: 1,
        name: 'builder',
        agent_type: 'builder',
        is_primary: 1,
        status: 'idle',
      },
      channel: 'chat',
      userId: 2,
      turnId: 1,
      turnModel: { model: 'claude-haiku-4-5', modelParams: null },
      turnAgentConfigId: 5,
      cwd: '/tmp/wt',
      baguetteTools: [],
    });
    await driver.newSession({ cwd: '/tmp/wt', model: 'claude-haiku-4-5' });

    mockPiSession.isStreaming = true;
    const steered = await driver.steer('pi-sess-1', 'Wait, also do X', { force: true });
    expect(steered).toBe(true);
    expect(mockPiSession.steer).toHaveBeenCalledWith('Wait, also do X');
  });

  it('isInterruptedSessionResumable checks pi_session_id', async () => {
    const service = new GenericAgentService({
      key: PI_AGENT_SDK_KEY,
      label: PI_AGENT_SDK_LABEL,
      servicePath: PI_AGENT_SERVICE_PATH,
      storedSessionIdColumn: 'pi_session_id',
      createDriver: ({ app, config }) => new PiDriver(app, config),
    });
    service.setup(makeApp());

    await expect(
      service.isInterruptedSessionResumable(
        { id: 1, user_id: 2 },
        { agent: { pi_session_id: 'pi-1' } }
      )
    ).resolves.toBe(true);
    await expect(
      service.isInterruptedSessionResumable({ id: 1, user_id: 2 }, { agent: {} })
    ).resolves.toBe(false);
  });
});
