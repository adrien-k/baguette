import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAgent = {
  agentId: 'cur-agent-1',
  send: vi.fn(),
};

vi.mock('@cursor/sdk', () => ({
  Agent: {
    create: vi.fn(async () => mockAgent),
    resume: vi.fn(async () => mockAgent),
    listRuns: vi.fn(async () => ({ items: [] })),
  },
  AgentBusyError: class AgentBusyError extends Error {},
  UnsupportedRunOperationError: class UnsupportedRunOperationError extends Error {},
}));

vi.mock('@cursor/sdk/sqlite', () => ({
  SqliteLocalAgentStore: {
    open: vi.fn(async () => ({})),
  },
}));

vi.mock('../adapt-tools.js', () => ({
  toolListToCursorCustomTools: vi.fn(() => ({})),
}));

import { Agent, AgentBusyError } from '@cursor/sdk';
import { CursorDriver } from '../driver.ts';
import { GenericAgentService } from '../../generic-agent-service.ts';
import {
  CURSOR_AGENT_SDK_KEY,
  CURSOR_AGENT_SDK_LABEL,
  CURSOR_AGENT_SERVICE_PATH,
} from '../meta.js';

function makeApp() {
  const onUsageLimit = vi.fn().mockResolvedValue(undefined);
  const db = (_table) => ({
    where: () => ({
      first: async () => undefined,
    }),
    whereIn: () => Promise.resolve([]),
  });
  return {
    onUsageLimit,
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
        return {
          get: vi.fn().mockResolvedValue({ id: 2 }),
          find: vi.fn().mockResolvedValue([]),
          patch: vi.fn().mockResolvedValue({}),
        };
      }),
      use: vi.fn(),
      emit: vi.fn(),
    },
  };
}

function makeRun(events, overrides = {}) {
  return {
    id: overrides.id ?? 'run-1',
    model: { id: 'composer-2' },
    error: overrides.error ?? null,
    supports: () => false,
    cancel: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue(undefined),
    async *stream() {
      for (const ev of events) yield ev;
    },
    ...overrides,
  };
}

describe('CursorDriver + GenericAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates agent, maps Cursor events to ACP updates, and handles busy retry', async () => {
    const { app } = makeApp();
    const driver = new CursorDriver(app, { api_key: 'cur-key' });
    const updates = [];
    driver.onUpdate((n) => updates.push(n.update));

    const run = makeRun([
      { type: 'thinking', text: 'hmm' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done!' }] } },
      {
        type: 'tool_call',
        call_id: 'c1',
        name: 'shell',
        status: 'running',
        args: { command: 'ls' },
      },
      {
        type: 'tool_call',
        call_id: 'c1',
        name: 'shell',
        status: 'completed',
        args: { command: 'ls' },
        result: { status: 'success', value: { exitCode: 0, stdout: 'a.txt' } },
      },
      {
        type: 'usage',
        usage: { inputTokens: 12, outputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      { type: 'status', status: 'FINISHED' },
    ]);

    const staleRun = {
      id: 'stale-run',
      status: 'running',
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    Agent.listRuns.mockResolvedValueOnce({ items: [staleRun] });
    mockAgent.send.mockRejectedValueOnce(new AgentBusyError('busy')).mockResolvedValueOnce(run);

    await driver.start({
      app,
      sdk: 'cursor',
      session: { id: 1, user_id: 2, session_path: null },
      agent: {
        id: 10,
        session_id: 1,
        name: 'builder',
        agent_type: 'builder',
        is_primary: 1,
        status: 'idle',
      },
      channel: 'chat',
      userId: 2,
      turnId: 1,
      turnModel: { model: 'composer-2', modelParams: null },
      turnAgentConfigId: 5,
      cwd: '/tmp/wt',
      userMcpServers: { docs: { type: 'http', url: 'https://mcp.example' } },
      baguetteTools: [],
    });

    const opened = await driver.newSession({ cwd: '/tmp/wt', model: 'composer-2' });
    expect(opened.sessionId).toBe('cur-agent-1');

    const res = await driver.prompt(opened.sessionId, 'Run ls');
    expect(staleRun.cancel).toHaveBeenCalled();
    expect(res.stopReason).toBe('end_turn');
    expect(res.usage?.input_tokens).toBe(12);
    expect(res.usage?.output_tokens).toBe(8);
    expect(updates.map((u) => u.sessionUpdate)).toEqual([
      'agent_thought_chunk',
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
    ]);
  });

  it('surfaces Cursor usage limits via sessions.onUsageLimit', async () => {
    const { app, onUsageLimit } = makeApp();
    const driver = new CursorDriver(app, { api_key: 'cur-key' });

    const run = makeRun([
      {
        type: 'status',
        status: 'ERROR',
        message: 'Usage limit reached. Resets at 2026-12-01T00:00:00Z',
      },
    ]);
    mockAgent.send.mockResolvedValueOnce(run);

    await driver.start({
      app,
      sdk: 'cursor',
      session: { id: 1, user_id: 2, session_path: null },
      agent: {
        id: 10,
        session_id: 1,
        name: 'builder',
        agent_type: 'builder',
        is_primary: 1,
        status: 'idle',
      },
      channel: 'chat',
      userId: 2,
      turnId: 1,
      turnModel: { model: 'composer-2', modelParams: null },
      turnAgentConfigId: 5,
      cwd: '/tmp/wt',
      baguetteTools: [],
    });

    const opened = await driver.newSession({ cwd: '/tmp/wt', model: 'composer-2' });
    const res = await driver.prompt(opened.sessionId, 'Hello');
    expect(res.stopReason).toBe('aborted');
    expect(onUsageLimit).toHaveBeenCalledWith(
      1,
      10,
      expect.objectContaining({ sdk: 'cursor', reason: 'rejected' })
    );
  });

  it('isInterruptedSessionResumable checks cursor_agent_id', async () => {
    const { app } = makeApp();
    const service = new GenericAgentService({
      key: CURSOR_AGENT_SDK_KEY,
      label: CURSOR_AGENT_SDK_LABEL,
      servicePath: CURSOR_AGENT_SERVICE_PATH,
      storedSessionIdColumn: 'cursor_agent_id',
      createDriver: ({ app: svcApp, config }) => new CursorDriver(svcApp, config),
    });
    service.setup(app);

    await expect(
      service.isInterruptedSessionResumable(
        { id: 1, user_id: 2 },
        { agent: { cursor_agent_id: 'cur-1' } }
      )
    ).resolves.toBe(true);
    await expect(
      service.isInterruptedSessionResumable({ id: 1, user_id: 2 }, { agent: {} })
    ).resolves.toBe(false);
  });
});
