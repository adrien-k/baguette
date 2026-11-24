import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AntigravityAgentService, toAcpMcpServers } from '../agent-service.ts';

function makeFakeAcpClient(overrides = {}) {
  const listeners = new Set();
  const emitUpdate = (notification) => {
    for (const cb of listeners) cb(notification);
  };
  return {
    stderrTail: '',
    emitUpdate,
    onSessionUpdate: vi.fn((cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    initialize: vi.fn().mockResolvedValue({ protocolVersion: 1 }),
    authenticate: vi.fn().mockResolvedValue(undefined),
    newSession: vi.fn().mockResolvedValue({
      sessionId: 'acp-new-1',
      configOptions: [
        {
          id: 'model',
          category: 'model',
          type: 'select',
          options: [{ value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
        },
      ],
      models: {
        availableModels: [
          { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
          { modelId: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
        ],
        currentModelId: 'gemini-3.8-flash-medium',
      },
      modes: {
        availableModes: [{ id: 'code' }, { id: 'plan' }],
        currentModeId: 'code',
      },
    }),
    resumeSession: vi.fn().mockResolvedValue({
      sessionId: 'acp-resumed-1',
      models: { availableModels: [{ modelId: 'gemini-3.8-flash-low' }] },
    }),
    setModel: vi.fn().mockResolvedValue({}),
    setConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
    prompt: vi.fn().mockResolvedValue({
      stopReason: 'end_turn',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        thoughtTokens: 0,
        totalTokens: 15,
      },
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFakeBridge() {
  return {
    url: 'http://127.0.0.1:4444/mcp',
    token: 'tok',
    acpServerConfig: {
      type: 'http',
      name: 'baguette',
      url: 'http://127.0.0.1:4444/mcp',
      headers: [{ name: 'Authorization', value: 'Bearer tok' }],
    },
    consumeToolResult: vi.fn(() => null),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeApp(overrides = {}) {
  const db = (table) => ({
    where: (conds) => ({
      first: async () => {
        if (table === 'sessions') {
          return {
            id: 1,
            user_id: 2,
            agent_sdk: 'antigravity',
            model: 'gemini-3.8-flash',
            session_path: null,
            status: 'idle',
            ...overrides.session,
          };
        }
        if (table === 'agents') {
          return {
            id: 11,
            session_id: 1,
            name: 'builder',
            agent_type: 'builder',
            agent_sdk: 'antigravity',
            antigravity_session_id: null,
            ...overrides.agent,
          };
        }
        if (table === 'agent_configs') {
          return { id: conds.id ?? 5, user_id: 2, sdk: 'antigravity', api_key_encrypted: null };
        }
        if (table === 'users') {
          return { id: 2, name: 'Test User', email: 'test@example.com' };
        }
        return undefined;
      },
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

function makeWriter() {
  return {
    log: vi.fn(),
    apply: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AntigravityAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toAcpMcpServers converts http, sse, and stdio configs into ACP format', () => {
    expect(
      toAcpMcpServers({
        gh: {
          type: 'http',
          url: 'https://mcp.example/http',
          headers: { Authorization: 'Bearer x' },
        },
        sseOne: { type: 'sse', url: 'https://mcp.example/sse' },
        local: { command: 'node', args: ['srv.js'], env: { FOO: '1' } },
      })
    ).toEqual([
      {
        type: 'http',
        name: 'gh',
        url: 'https://mcp.example/http',
        headers: [{ name: 'Authorization', value: 'Bearer x' }],
      },
      {
        type: 'sse',
        name: 'sseOne',
        url: 'https://mcp.example/sse',
        headers: [],
      },
      {
        name: 'local',
        command: 'node',
        args: ['srv.js'],
        env: [{ name: 'FOO', value: '1' }],
      },
    ]);
  });

  it('runTurn opens session, sets model variant + plan mode, streams turn, and cleans up', async () => {
    const client = makeFakeAcpClient();
    const bridge = makeFakeBridge();
    const service = new AntigravityAgentService({
      spawnClient: () => client,
      startMcpBridge: vi.fn(async () => bridge),
    });
    service.setup(makeApp());

    const persistId = vi.fn();
    const writer = makeWriter();
    const result = await service.runTurn({
      session: { id: 1, user_id: 2 },
      userText: 'Build feature X',
      writer,
      persistAntigravitySessionId: persistId,
      agentOptions: {
        cwd: '/tmp/wt',
        binary: '/usr/bin/agy',
        env: {},
        apiKey: null,
        model: 'gemini-3.8-flash',
        modelParams: JSON.stringify([{ id: 'reasoning', value: 'low' }]),
        systemPromptAppend: 'Follow rules.',
        userMcpServers: [],
        baguetteTools: [{ name: 'CreateTodo', schema: {}, handler: vi.fn() }],
        storedAntigravitySessionId: null,
        channel: 'chat',
      },
    });

    expect(result.outcome).toBe('completed');
    expect(result.turnUsage?.total_tokens).toBe(15);
    expect(client.initialize).toHaveBeenCalled();
    expect(client.newSession).toHaveBeenCalledWith({
      cwd: '/tmp/wt',
      mcpServers: [bridge.acpServerConfig],
      systemPromptAppend: 'Follow rules.',
    });
    expect(persistId).toHaveBeenCalledWith('acp-new-1');
    expect(client.setModel).toHaveBeenCalledWith('acp-new-1', 'gemini-3.8-flash-low');
    expect(client.closeSession).toHaveBeenCalledWith('acp-new-1');
    expect(client.close).toHaveBeenCalled();
    expect(bridge.close).toHaveBeenCalled();
  });

  it('runTurn resumes stored session and falls back to newSession on stale resume error', async () => {
    const client = makeFakeAcpClient({
      resumeSession: vi.fn().mockRejectedValue(new Error('Session not found')),
    });
    const service = new AntigravityAgentService({
      spawnClient: () => client,
      startMcpBridge: vi.fn(async () => makeFakeBridge()),
    });
    service.setup(makeApp());

    const persistId = vi.fn();
    const res = await service.runTurn({
      session: { id: 1, user_id: 2 },
      userText: 'Continue',
      writer: makeWriter(),
      persistAntigravitySessionId: persistId,
      agentOptions: {
        cwd: '/tmp/wt',
        binary: 'agy',
        env: {},
        apiKey: null,
        model: null,
        modelParams: null,
        systemPromptAppend: null,
        userMcpServers: [],
        baguetteTools: [],
        storedAntigravitySessionId: 'stale-acp-id',
        channel: 'chat',
      },
    });

    expect(res.outcome).toBe('completed');
    expect(client.resumeSession).toHaveBeenCalledWith({
      sessionId: 'stale-acp-id',
      cwd: '/tmp/wt',
      mcpServers: [],
      systemPromptAppend: null,
    });
    expect(client.newSession).toHaveBeenCalled();
    expect(persistId).toHaveBeenCalledWith('acp-new-1');
  });

  it('completeText spawns ephemeral session, applies model, collects chunks, and closes cleanly', async () => {
    const client = makeFakeAcpClient({
      prompt: vi.fn(async () => {
        client.emitUpdate({
          sessionId: 'acp-new-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: '  42  ' },
          },
        });
        return { stopReason: 'end_turn' };
      }),
    });
    const service = new AntigravityAgentService({ spawnClient: () => client });
    service.setup(makeApp());

    const text = await service.completeText('What is 6*7?', {
      userId: 2,
      agentConfigId: 5,
      model: 'gemini-3.8-flash',
    });

    expect(text).toBe('42');
    expect(client.setConfigOption).toHaveBeenCalledWith('acp-new-1', 'model', 'gemini-3.8-flash');
    expect(client.closeSession).toHaveBeenCalledWith('acp-new-1');
    expect(client.close).toHaveBeenCalled();
  });

  it('stopTurn aborts signal, cancels ACP session, and drops active session state', async () => {
    const client = makeFakeAcpClient();
    const service = new AntigravityAgentService({ spawnClient: () => client });
    service.setup(makeApp());

    const controller = new AbortController();
    service._activeSessions.set(1, {
      isProcessing: true,
      userId: 2,
      acpClient: client,
      acpSessionId: 'acp-live-1',
      abortController: controller,
    });

    expect(service.getActiveSession(1)).toBeTruthy();
    await expect(service.get(1)).resolves.toBeTruthy();

    await service.stopTurn(1);
    expect(controller.signal.aborted).toBe(true);
    expect(client.cancel).toHaveBeenCalledWith('acp-live-1');
    expect(service.getActiveSession(1)).toBeNull();
  });

  it('isInterruptedSessionResumable checks agent antigravity_session_id', async () => {
    const service = new AntigravityAgentService();
    service.setup(makeApp());
    await expect(
      service.isInterruptedSessionResumable(
        { id: 1, user_id: 2 },
        { agent: { antigravity_session_id: 'agy-123' } }
      )
    ).resolves.toBe(true);
    await expect(
      service.isInterruptedSessionResumable({ id: 1, user_id: 2 }, { agent: {} })
    ).resolves.toBe(false);
  });
});
