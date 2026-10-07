import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPiSession = {
  sessionId: 'pi-sess-1',
  isStreaming: false,
  prompt: vi.fn().mockResolvedValue(undefined),
  steer: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
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
    DefaultResourceLoader: vi.fn().mockImplementation(() => ({
      reload: vi.fn().mockResolvedValue(undefined),
    })),
    resolveCliModel: vi.fn(() => ({ model: { id: 'test-model' }, error: undefined })),
  };
});

vi.mock('../pi-models.js', () => ({
  createPiModelRuntime: vi.fn().mockResolvedValue({}),
}));

vi.mock('../baguette-mcp-server.js', () => ({
  buildPiCustomTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../pi/pi-sdk-turn.ts', () => ({
  processPiSessionStream: vi.fn(async () => ({
    finishedOk: true,
    turnUsage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 0,
      model: null,
    },
  })),
}));

import { PiAgentService } from '../feathers/pi-agent.service.ts';
import { createAgentSession } from '@earendil-works/pi-coding-agent';

function makeApp(overrides = {}) {
  const sessionsPatch = vi.fn().mockResolvedValue({});
  const sessionsOnTurnStart = vi.fn().mockResolvedValue(undefined);
  const sessionsOnTurnComplete = vi.fn().mockResolvedValue(undefined);
  return {
    get: vi.fn((key) => {
      if (key === 'db') {
        return (_table) => ({
          where: () => ({
            first: async () => ({
              id: 1,
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
      }
      return undefined;
    }),
    service: vi.fn((name) => {
      if (name === 'users') {
        return { get: vi.fn().mockResolvedValue({ id: 2, pi_api_key: 'key' }) };
      }
      if (name === 'user-repos') {
        return { find: vi.fn().mockResolvedValue([]) };
      }
      if (name === 'sessions') {
        return {
          patch: sessionsPatch,
          onTurnStart: sessionsOnTurnStart,
          onTurnComplete: sessionsOnTurnComplete,
          recordPiUsage: vi.fn().mockResolvedValue(0),
          emit: vi.fn(),
        };
      }
      if (name === 'messages') {
        return { on: vi.fn(), create: vi.fn() };
      }
      if (name === 'session-review') {
        return {
          onAgentTurnComplete: vi.fn().mockResolvedValue(undefined),
          _persistStatus: vi.fn().mockResolvedValue(undefined),
        };
      }
      return {};
    }),
    use: vi.fn(),
    emit: vi.fn(),
  };
}

describe('PiAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPiSession.isStreaming = false;
  });

  it('createOrResumePiSession calls createAgentSession and returns session', async () => {
    const service = new PiAgentService();
    service.app = makeApp();
    const session = { id: 1, user_id: 2, session_path: 'sessions/wt', model: 'm' };
    const agentOptions = {
      cwd: '/tmp',
      modelRuntime: {},
      customTools: [],
    };
    const piSession = await service.createOrResumePiSession(session, {
      agentOptions,
      persistPiSessionId: vi.fn(),
    });
    expect(createAgentSession).toHaveBeenCalled();
    expect(piSession.sessionId).toBe('pi-sess-1');
  });

  it('handleMessageCreated ignores non-pi agent_sdk', async () => {
    const service = new PiAgentService();
    service.app = makeApp({ session: { agent_sdk: 'claude' } });
    service.setup(service.app);
    const runTurnSpy = vi.spyOn(service, '_runTurn').mockResolvedValue(undefined);
    await service.handleMessageCreated({
      id: 10,
      type: 'user',
      session_id: 1,
      agent_sdk: 'claude',
      agent_type: 'builder',
      message_json: JSON.stringify({ type: 'user', content: 'hi' }),
    });
    expect(runTurnSpy).not.toHaveBeenCalled();
  });

  it('runTurn keeps caller-owned active session until caller clears it', async () => {
    const service = new PiAgentService();
    service.app = makeApp();
    const outerState = { isProcessing: true, userId: 2, piSession: null };
    service._activeSessions.set(1, outerState);
    const writer = { close: vi.fn() };
    await service.runTurn({
      session: { id: 1, user_id: 2, session_path: 'sessions/wt', model: 'm' },
      userText: 'hello',
      agentOptions: { cwd: '/tmp', modelRuntime: {}, customTools: [] },
      writer,
      activeKey: 1,
      activeSessionState: outerState,
    });
    expect(service._activeSessions.has(1)).toBe(true);
    expect(outerState.piSession).toBe(mockPiSession);
    service._activeSessions.delete(1);
  });

  it('runTurn clears self-managed active session when finished', async () => {
    const service = new PiAgentService();
    service.app = makeApp();
    const writer = { close: vi.fn() };
    await service.runTurn({
      session: { id: 1, user_id: 2, session_path: 'sessions/wt', model: 'm' },
      userText: 'hello',
      agentOptions: { cwd: '/tmp', modelRuntime: {}, customTools: [] },
      writer,
      activeKey: 1,
    });
    expect(service._activeSessions.has(1)).toBe(false);
  });

  it('handleMessageCreated steers when force and streaming', async () => {
    const service = new PiAgentService();
    service.app = makeApp();
    mockPiSession.isStreaming = true;
    service._activeSessions.set(1, {
      isProcessing: true,
      userId: 2,
      piSession: mockPiSession,
    });
    const runTurnSpy = vi.spyOn(service, '_runTurn').mockResolvedValue(undefined);
    await service.handleMessageCreated({
      id: 11,
      type: 'user',
      session_id: 1,
      agent_sdk: 'pi',
      agent_type: 'builder',
      force: true,
      message_json: JSON.stringify({ type: 'user', content: 'steer me' }),
    });
    expect(mockPiSession.steer).toHaveBeenCalledWith('steer me');
    expect(runTurnSpy).not.toHaveBeenCalled();
  });
});
