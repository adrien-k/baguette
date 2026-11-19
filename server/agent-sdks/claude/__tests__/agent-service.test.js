import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Generated label' }],
  });
  class MockAnthropic {
    constructor() {
      this.messages = { create: mockCreate };
    }
  }
  return { default: MockAnthropic };
});

vi.mock('../../../db.js', () => ({ default: vi.fn() }));

vi.mock('../../../services/github.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    getOpenPR: vi.fn(),
    remoteHasNewCommits: vi.fn(),
  };
});

vi.mock('../../../services/agent-settings.js', () => ({
  getAllowedCommandsFromUser: vi.fn().mockReturnValue([]),
  getGithubToken: vi.fn((user) => user?.access_token || null),
}));

vi.mock('../../../services/baguette-config.js', () => ({
  BAGUETTE_DIR: '.baguette',
  loadBaguetteConfig: vi.fn(),
  loadBaguetteAgentPrompt: vi.fn().mockResolvedValue(null),
  interpolateEnv: vi.fn(),
  getScriptBlock: vi.fn(),
}));

vi.mock('../adapt-tools.js', () => ({
  toolListToClaudeMcpServer: vi.fn(() => ({})),
}));
vi.mock('../../../services/mcp/server.js', () => ({
  buildBaguetteToolList: vi.fn(async () => []),
  buildReviewerAgentTools: vi.fn(() => []),
}));
vi.mock('../../../services/mcp/lib/slack.js', () => ({
  loadConfiguredSlackApps: vi.fn(async () => []),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb(null, { stdout: '', stderr: '' })),
}));

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '1.1.1.1', family: 4 }]),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import path from 'path';
import { createTestDb } from '../../../test-utils/db.js';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { loadBaguetteConfig } from '../../../services/baguette-config.js';

import { REPOS_DIR } from '../../../config.js';
import { ClaudeAgentService } from '../agent-service.ts';
import { ensureReviewerAgentRow } from '../../../services/agents-db.js';
import { reviewTurnKey } from '../../../services/review-agent-turn.js';
import {
  getPrimaryBuilderForSession,
  insertSessionWithPrimaryBuilder,
} from '../../../test-utils/session-agents.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Create a mock async iterable that the SDK query returns.
 * The service's processMessages loop iterates this.
 */
function makeAsyncIterable(messages) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < messages.length) return { value: messages[i++], done: false };
          return { value: undefined, done: true };
        },
      };
    },
    setPermissionMode: vi.fn(),
    setModel: vi.fn(),
    close: vi.fn(),
  };
}

/** Iterator that never yields — keeps `processMessages` running so the session stays in `_activeSessions`. */
function makeNeverEndingIterable() {
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return new Promise(() => {});
        },
      };
    },
    setPermissionMode: vi.fn(),
    setModel: vi.fn(),
    close: vi.fn(),
  };
}

/**
 * Create a mock Feathers app with tracked service calls.
 */
function makeMockApp(db) {
  const sessionPatch = vi.fn().mockResolvedValue({});
  const agentPatch = vi.fn().mockResolvedValue({});
  const sessionRemove = vi.fn().mockResolvedValue({});
  const sessionEmit = vi.fn();
  const messageCreate = vi.fn().mockResolvedValue({ id: 1 });
  const genericRemove = vi.fn().mockResolvedValue({});
  const getClaudeEnv = vi.fn().mockResolvedValue({});
  const deleteSessionTasks = vi.fn();
  const createTask = vi.fn().mockResolvedValue({});
  const onUsageLimit = vi.fn().mockResolvedValue({ action: 'stop', resume_at: null });
  const insertUsageRow = vi.fn().mockResolvedValue(0);
  const reviewAgentTurnStub = {
    onAgentTurnComplete: vi.fn().mockResolvedValue(undefined),
    _persistStatus: vi.fn().mockResolvedValue(undefined),
    peekTurnExtras: vi.fn(() => null),
    prepareReviewContext: vi.fn().mockResolvedValue({
      systemPrompt: '',
      extraPrompt: undefined,
      turnAgent: { agent_sdk: 'claude', model: null, model_params: null },
    }),
    stopReviewerAgent: vi.fn().mockResolvedValue(undefined),
  };

  return {
    get: function (key) {
      if (key === 'db') return db;
      if (key === 'reviewAgentTurn') return reviewAgentTurnStub;
    },
    _reviewAgentTurn: reviewAgentTurnStub,
    service: vi.fn((name) => {
      if (name === 'sessions')
        return {
          patch: sessionPatch,
          remove: sessionRemove,
          emit: sessionEmit,
          getClaudeEnv,
          onActivity: async () => {},
          onTurnStart: async () => {},
          onTurnComplete: async () => {},
          onUsageLimit,
          insertUsageRow,
          get: async (id) => db('sessions').where({ id }).first(),
        };
      if (name === 'agents') return { patch: agentPatch };
      if (name === 'messages') return { create: messageCreate, remove: genericRemove };
      if (name === 'tasks') return { create: createTask, deleteSessionTasks };
      if (name === 'users')
        return { get: vi.fn().mockResolvedValue({ id: 1, access_token: 'tok' }) };
      return { patch: vi.fn(), create: vi.fn(), remove: genericRemove };
    }),
    // Exposed for assertions
    _sessionPatch: sessionPatch,
    _agentPatch: agentPatch,
    _sessionRemove: sessionRemove,
    _sessionEmit: sessionEmit,
    _messageCreate: messageCreate,
    _onUsageLimit: onUsageLimit,
    _insertUsageRow: insertUsageRow,
  };
}

const BASE_SESSION_DATA = {
  user_id: 1,
  short_id: 'abc12',
  repo_full_name: 'owner/repo',
  base_branch: 'main',
  initial_prompt: 'Fix the bug',
  // Must follow REPOS_DIR/<stripped>/sessions/<id> so createCanUseTool can derive the repo dir
  session_path: path.join(REPOS_DIR, 'owner-repo', 'sessions', 'test-session'),
  repo_id: 7,
  remote_branch: null,
  status: 'stopped',
};
let BASE_SESSION_ID; // auto-generated integer id, set in beforeEach
let BASE_BUILDER;

const BASE_USER = { id: 1, github_id: 1, username: 'test' };

const BASE_REPO = {
  id: 7,
  full_name: 'owner/repo',
  repo_path: '/data/repos/owner-repo',
  stripped_name: 'owner-repo',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ClaudeAgentService', () => {
  const db = createTestDb();
  let mockApp;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockApp = makeMockApp(db);

    await db('users').insert(BASE_USER);
    const { insertTestAgentConfig } = await import('../../../test-utils/agent-configs.js');
    const claudeConfigId = await insertTestAgentConfig(db, BASE_USER.id, {
      apiKey: 'sk-ant-test-key',
    });
    await db('repos').insert(BASE_REPO);
    BASE_SESSION_ID = await insertSessionWithPrimaryBuilder(db, {
      ...BASE_SESSION_DATA,
      agent_config_id: claudeConfigId,
      agent_sdk: 'claude',
      model: 'sonnet',
    });
    BASE_BUILDER = await getPrimaryBuilderForSession(db, BASE_SESSION_ID);

    // Default mocks
    loadBaguetteConfig.mockResolvedValue(null);

    // Use mockImplementation so each query() call gets a fresh iterable
    query.mockImplementation(() => makeAsyncIterable([]));
  });

  describe('buildQueryOptions', () => {
    it('passes the stored claude_session_id as resume on a chat query', async () => {
      await db('agents').where({ id: BASE_BUILDER.id }).update({
        claude_session_id: 'claude-sess-abc',
      });
      const builder = await db('agents').where({ id: BASE_BUILDER.id }).first();
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, builder, {
        model: builder.model,
        turnAgentConfigId: builder.agent_config_id,
      });
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ resume: 'claude-sess-abc' }),
        })
      );
    });

    it('omits resume when the caller does not pass a session id', async () => {
      const service = new ClaudeAgentService();
      service.setup(mockApp);
      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      const options = await service.buildQueryOptions(sessionRow, {
        claudeEnv: { ANTHROPIC_API_KEY: 'key' },
        model: 'sonnet',
      });
      expect(options.resume).toBeUndefined();
    });

    it('merges enabled user MCP servers beside the baguette server', async () => {
      const { encrypt } = await import('../../../lib/encrypt.js');
      const [serverId] = await db('user_mcp_servers').insert({
        user_id: BASE_USER.id,
        name: 'docs',
        transport: 'http',
        url: 'https://mcp.example/mcp',
        enabled: 0,
        bearer_token_encrypted: encrypt('secret-token'),
      });
      await db('sessions')
        .where({ id: BASE_SESSION_ID })
        .update({ mcp_servers: JSON.stringify({ [serverId]: true }) });
      const service = new ClaudeAgentService();
      service.setup(mockApp);
      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      const options = await service.buildQueryOptions(sessionRow, {
        claudeEnv: { ANTHROPIC_API_KEY: 'key' },
        model: 'sonnet',
      });
      expect(options.mcpServers.docs).toEqual({
        type: 'http',
        url: 'https://mcp.example/mcp',
        headers: { Authorization: 'Bearer secret-token' },
      });
      expect(options.mcpServers.baguette).toEqual({});
    });
  });

  // ── 1. Session creation ────────────────────────────────────────────────────

  describe('createAgentSession', () => {
    it('starts the query loop with cwd pointing at the worktree, sets status to running', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      const sessionState = await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      // query() started with cwd pointing at the worktree
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            cwd: path.join(REPOS_DIR, 'owner-repo', 'sessions', 'test-session'),
          }),
        })
      );

      // Status patched to 'running'
      expect(mockApp._agentPatch).toHaveBeenCalledWith(
        BASE_BUILDER.id,
        { status: 'running' },
        expect.anything()
      );

      // Session state returned
      expect(sessionState.sessionId).toBe(BASE_SESSION_ID);
      expect(sessionState.absoluteSessionPath).toBe(
        path.join(REPOS_DIR, 'owner-repo', 'sessions', 'test-session')
      );

      // Empty stream ends immediately; in-memory session must be disposed (no leak)
      await vi.waitFor(() => {
        expect(service.getActiveSession(BASE_SESSION_ID)).toBeUndefined();
      });
    });

    it('passes canUseTool to query options so the SDK can request permissions', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      let capturedOptions;
      query.mockImplementation(({ options }) => {
        capturedOptions = options;
        return makeAsyncIterable([]);
      });

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      expect(typeof capturedOptions.canUseTool).toBe('function');
    });
  });

  // ── 2. Assistant response ──────────────────────────────────────────────────

  describe('assistant response', () => {
    it('persists assistant messages via the messages service', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      const assistantMsg = {
        type: 'assistant',
        uuid: 'msg-uuid-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
      };

      query.mockImplementation(() =>
        makeAsyncIterable([
          { type: 'system', subtype: 'init', session_id: 'claude-abc' },
          assistantMsg,
          { type: 'result', subtype: 'success', is_error: false },
        ])
      );

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      // Wait for the background processMessages loop to finish
      await vi.waitFor(() => {
        expect(mockApp._messageCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            session_id: BASE_SESSION_ID,
            type: 'assistant',
            uuid: 'msg-uuid-1',
          }),
          expect.anything()
        );
      });
    });

    it('stores the claude_session_id from the init message', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      query.mockImplementation(() =>
        makeAsyncIterable([
          { type: 'system', subtype: 'init', session_id: 'claude-xyz' },
          { type: 'result', subtype: 'success', is_error: false },
        ])
      );

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      const sessionState = await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        expect(sessionState.claudeSessionId).toBe('claude-xyz');
      });
    });
  });

  // ── Turn-ending Baguette tools ─────────────────────────────────────────────

  describe('turn-ending Baguette tools', () => {
    it('keeps approval and records usage when endTurnAwaitingUser is set mid-turn', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      const recordSpy = vi.spyOn(service, '_recordClaudeTurnUsage').mockResolvedValue(undefined);

      const resultMsg = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.01,
      };
      vi.spyOn(service, '_consumeQuery').mockImplementation(async (sessionState) => {
        sessionState.endTurnAwaitingUser = true;
        return {
          turnComplete: true,
          streamFailed: false,
          outcome: 'completed',
          lastResult: resultMsg,
        };
      });

      const sessionState = {
        sessionId: BASE_SESSION_ID,
        userId: BASE_USER.id,
        agentId: BASE_BUILDER.id,
        turnChannel: 'chat',
        endTurnAwaitingUser: false,
        streamWriter: null,
      };

      await service.processMessages(sessionState);

      expect(recordSpy).toHaveBeenCalled();
      expect(mockApp._agentPatch).toHaveBeenCalledWith(
        BASE_BUILDER.id,
        { status: 'approval', active_turn_id: null },
        expect.anything()
      );
    });
  });

  // ── 3. Assistant success ───────────────────────────────────────────────────

  describe('assistant success', () => {
    it('patches session status to completed when result is successful', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      query.mockImplementation(() =>
        makeAsyncIterable([
          { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.002 },
        ])
      );

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        expect(mockApp._agentPatch).toHaveBeenCalledWith(
          BASE_BUILDER.id,
          { status: 'completed', active_turn_id: null },
          expect.anything()
        );
      });
    });

    it('persists the result message to the messages service', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      query.mockImplementation(() =>
        makeAsyncIterable([
          { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.005 },
        ])
      );

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        expect(mockApp._messageCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            session_id: BASE_SESSION_ID,
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0.005,
          }),
          expect.anything()
        );
      });
    });

    it('waits for background tasks to complete before closing the query', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      // Simulate: task_started registers the task, result arrives while it is still live,
      // then task_notification fires once the task finishes.
      const mockIterable = makeAsyncIterable([
        {
          type: 'system',
          subtype: 'task_started',
          task_id: 'bg-1',
          task_type: 'local_bash',
          description: 'sub',
          is_backgrounded: true,
        },
        { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 },
        // task_notification arrives AFTER result — baguette must still be consuming the stream here
        {
          type: 'system',
          subtype: 'task_notification',
          task_id: 'bg-1',
          status: 'completed',
          output_file: '',
          summary: 'done',
        },
      ]);

      query.mockImplementation(() => mockIterable);

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        expect(mockApp._messageCreate).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'system', subtype: 'task_notification' }),
          expect.anything()
        );
        const statusPatches = mockApp._agentPatch.mock.calls.filter(([, patch]) => patch.status);
        expect(statusPatches.map(([, patch]) => patch.status)).toEqual(['running', 'completed']);
      });
    });

    it('resumes the turn when a background task completes (SDK auto-continuation)', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      // The SDK auto-starts a continuation turn after task_notification so Claude can process it.
      // Baguette must stay in the loop past the first result and the task_notification, then handle
      // the second result from Claude's response to the notification.
      const mockIterable = makeAsyncIterable([
        {
          type: 'system',
          subtype: 'task_started',
          task_id: 'bg-2',
          task_type: 'local_agent',
          description: 'sub',
          is_backgrounded: true,
        },
        { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 },
        {
          type: 'system',
          subtype: 'task_notification',
          task_id: 'bg-2',
          status: 'completed',
          output_file: '',
          summary: 'finished',
        },
        // SDK auto-continuation: Claude responds to the notification and produces a second result
        {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Task done.' }] },
        },
        { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 },
      ]);

      query.mockImplementation(() => mockIterable);

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        expect(mockApp._messageCreate).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'assistant' }),
          expect.anything()
        );
        const statusPatches = mockApp._agentPatch.mock.calls.filter(([, patch]) => patch.status);
        expect(statusPatches.map(([, patch]) => patch.status)).toEqual(['running', 'completed']);
      });
    });
    it('does not restart the turn on intermediate task_notification events (non-terminal status)', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      // Intermediate notifications (status !== 'completed'/'failed'/'error') must not trigger
      // an extra status: 'running' patch. Only the final 'completed' one may extend the stream.
      const mockIterable = makeAsyncIterable([
        {
          type: 'system',
          subtype: 'task_started',
          task_id: 'bg-3',
          task_type: 'local_agent',
          description: 'sub',
          is_backgrounded: true,
        },
        { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 },
        // Two intermediate notifications — must be persisted but must NOT trigger a restart
        {
          type: 'system',
          subtype: 'task_notification',
          task_id: 'bg-3',
          status: 'running',
          summary: 'still going',
        },
        {
          type: 'system',
          subtype: 'task_notification',
          task_id: 'bg-3',
          status: 'running',
          summary: 'still going 2',
        },
        // Final terminal notification — keep consuming for SDK auto-continuation
        {
          type: 'system',
          subtype: 'task_notification',
          task_id: 'bg-3',
          status: 'completed',
          output_file: '',
          summary: 'done',
        },
        // SDK auto-continuation result
        { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 },
      ]);

      query.mockImplementation(() => mockIterable);

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        const notifCalls = mockApp._messageCreate.mock.calls.filter(
          ([msg]) => msg.subtype === 'task_notification'
        );
        expect(notifCalls).toHaveLength(3);
        const statusPatches = mockApp._agentPatch.mock.calls.filter(([, patch]) => patch.status);
        expect(statusPatches.map(([, patch]) => patch.status)).toEqual(['running', 'completed']);
      });
    });

    it('restores completed when auto-resume never arrives after a background task', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      query.mockImplementation(() =>
        makeAsyncIterable([
          {
            type: 'system',
            subtype: 'task_started',
            task_id: 'bg-noresume',
            task_type: 'local_bash',
            description: 'sub',
            is_backgrounded: true,
          },
          { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 },
          {
            type: 'system',
            subtype: 'task_notification',
            task_id: 'bg-noresume',
            status: 'completed',
            output_file: '',
            summary: 'done',
          },
        ])
      );

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        const patchCalls = mockApp._agentPatch.mock.calls;
        const lastStatusPatch = [...patchCalls].reverse().find(([, patch]) => patch.status);
        expect(lastStatusPatch[1]).toEqual({ status: 'completed', active_turn_id: null });
      });
    });
  });

  // ── 5. Assistant failure ───────────────────────────────────────────────────

  describe('assistant failure', () => {
    it('hands a quota-shaped failed result to the usage-limit policy and stops the agent', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      // Real-world quota shape: the CLI ends the turn with an error result carrying the
      // usage-limit text instead of the stream throwing.
      query.mockImplementation(() =>
        makeAsyncIterable([
          { type: 'system', subtype: 'init', session_id: 'sdk-1' },
          {
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            errors: ['You have hit your usage limit. Please wait until 10:00pm to continue.'],
            total_cost_usd: 0,
          },
        ])
      );

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        expect(mockApp._onUsageLimit).toHaveBeenCalledWith(
          BASE_SESSION_ID,
          BASE_BUILDER.id,
          expect.objectContaining({ sdk: 'claude', reason: 'rejected' })
        );
      });
      await vi.waitFor(() => {
        expect(mockApp._agentPatch).toHaveBeenCalledWith(
          BASE_BUILDER.id,
          { status: 'stopped', active_turn_id: null },
          expect.anything()
        );
      });
      // The policy notice replaces the generic failure toast.
      expect(mockApp._sessionEmit).not.toHaveBeenCalledWith('app:error', expect.anything());
    });

    it('stops a turn when a rejected rate_limit_event arrives mid-stream', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      query.mockImplementation(() =>
        makeAsyncIterable([
          { type: 'system', subtype: 'init', session_id: 'sdk-1' },
          {
            type: 'rate_limit_event',
            rate_limit_info: {
              status: 'rejected',
              rateLimitType: 'five_hour',
              resetsAt: 1793064000,
            },
          },
        ])
      );
      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });
      await vi.waitFor(() => {
        expect(mockApp._onUsageLimit).toHaveBeenCalledWith(
          BASE_SESSION_ID,
          BASE_BUILDER.id,
          expect.objectContaining({ reset_at_ms: 1793064000_000 })
        );
      });
    });

    it('fails the turn and surfaces app:error when the query ends without a result', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      // Iterator drains without any result and without throwing — the Claude mirror of
      // the Cursor silent stream end: previously no verdict, no message, agent stuck.
      query.mockImplementation(() =>
        makeAsyncIterable([{ type: 'system', subtype: 'init', session_id: 'sdk-1' }])
      );

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        expect(mockApp._agentPatch).toHaveBeenCalledWith(
          BASE_BUILDER.id,
          {
            status: 'failed',
            active_turn_id: null,
          },
          expect.anything()
        );
      });
      await vi.waitFor(() => {
        expect(mockApp._sessionEmit).toHaveBeenCalledWith(
          'app:error',
          expect.objectContaining({
            sessionId: BASE_SESSION_ID,
            message: expect.stringContaining('without completing'),
          })
        );
      });
      expect(mockApp._messageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: BASE_SESSION_ID,
          agent_id: BASE_BUILDER.id,
          type: 'turn_result',
        }),
        expect.anything()
      );
    });

    it('attributes the silent-end failure to the reviewer agent without review special-casing', async () => {
      const reviewer = await ensureReviewerAgentRow(db, BASE_SESSION_ID, {
        agent_config_id: BASE_BUILDER.agent_config_id,
        agent_sdk: 'claude',
        model: 'sonnet',
        status: 'running',
      });
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      query.mockImplementation(() =>
        makeAsyncIterable([{ type: 'system', subtype: 'init', session_id: 'sdk-1' }])
      );
      const state = service._openQuery({
        sessionId: BASE_SESSION_ID,
        agentId: reviewer.id,
        userId: 1,
        queryOptions: {},
        extraState: { turnChannel: 'review' },
        activeKey: reviewTurnKey(reviewer.id),
      });

      await service.processMessages(state);

      // No review-side status handler was needed for the row itself; the reviewer's
      // own status stays owned by the review turn service via onAgentTurnComplete.
      expect(mockApp._reviewAgentTurn._persistStatus).not.toHaveBeenCalled();
      expect(mockApp._sessionEmit).toHaveBeenCalledWith(
        'app:error',
        expect.objectContaining({ sessionId: BASE_SESSION_ID, message: expect.any(String) })
      );
      await vi.waitFor(() => {
        expect(mockApp._reviewAgentTurn.onAgentTurnComplete).toHaveBeenCalledWith(
          expect.objectContaining({ id: BASE_SESSION_ID }),
          'failed',
          expect.objectContaining({
            sdk: 'claude',
            error_message:
              'Agent ended the turn without completing. Send your message again to continue.',
          })
        );
      });
    });

    it('patches session status to failed when result has is_error=true', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      query.mockImplementation(() =>
        makeAsyncIterable([{ type: 'result', subtype: 'error', is_error: true }])
      );

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        expect(mockApp._agentPatch).toHaveBeenCalledWith(
          BASE_BUILDER.id,
          {
            status: 'failed',
            active_turn_id: null,
          },
          expect.anything()
        );
      });
    });

    it('patches session status to failed when the query stream throws', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      const errorIterable = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error('Stream broken');
            },
          };
        },
        setPermissionMode: vi.fn(),
        setModel: vi.fn(),
        close: vi.fn(),
      };
      query.mockImplementation(() => errorIterable);

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      await vi.waitFor(() => {
        expect(mockApp._agentPatch).toHaveBeenCalledWith(
          BASE_BUILDER.id,
          {
            status: 'failed',
            active_turn_id: null,
          },
          expect.anything()
        );
      });

      // Error forwarded to the client via sessions service emit
      await vi.waitFor(() => {
        expect(mockApp._sessionEmit).toHaveBeenCalledWith(
          'app:error',
          expect.objectContaining({ sessionId: BASE_SESSION_ID })
        );
      });

      await vi.waitFor(() => {
        expect(mockApp._messageCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            session_id: BASE_SESSION_ID,
            type: 'turn_result',
            message_json: expect.stringContaining('Stream broken'),
          }),
          expect.anything()
        );
      });
    });
  });

  // ── 6. handleMessageCreated ───────────────────────────────────────────────

  // ── Usage-limit policy: every action × limit hit / not hit ────────────────

  describe('usage limit policy', () => {
    const overageOn = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', isUsingOverage: true, resetsAt: 1793064000 },
    };
    const rejected = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: 1793064000 },
    };
    // ~$15 at Sonnet output rates: over any small cap. 20k tokens ≈ $0.30.
    const assistant = (id, outputTokens) => ({
      type: 'assistant',
      message: {
        id,
        model: 'claude-sonnet-4-5',
        content: [],
        usage: { input_tokens: 0, output_tokens: outputTokens },
      },
    });
    const done = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 };
    const init = { type: 'system', subtype: 'init', session_id: 'sdk-1' };

    async function runTurn(policy, messages) {
      await db('sessions').where({ id: BASE_SESSION_ID }).update(policy);
      query.mockImplementation(() => makeAsyncIterable([init, ...messages]));
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });
      await vi.waitFor(() => {
        expect(mockApp._agentPatch).toHaveBeenCalledWith(
          BASE_BUILDER.id,
          expect.objectContaining({ status: expect.stringMatching(/completed|stopped/) }),
          expect.anything()
        );
      });
      return db('sessions').where({ id: BASE_SESSION_ID }).first();
    }

    const reasonOf = () => mockApp._onUsageLimit.mock.calls.at(-1)?.[2]?.reason;

    it.each(['stop', 'wait', 'continue'])(
      '%s: a turn that never hits a limit just completes',
      async (action) => {
        const row = await runTurn({ usage_limit_action: action }, [assistant('a', 1000), done]);
        expect(mockApp._onUsageLimit).not.toHaveBeenCalled();
        expect(row.usage_limit_spent).toBe(0);
      }
    );

    it.each(['stop', 'wait', 'continue'])(
      '%s: a rejected subscription limit is reported to the policy',
      async (action) => {
        await runTurn({ usage_limit_action: action }, [rejected]);
        expect(reasonOf()).toBe('rejected');
        expect(mockApp._onUsageLimit.mock.calls[0][2].reset_at_ms).toBe(1793064000_000);
      }
    );

    it.each(['stop', 'wait'])('%s: drawing paid overage is refused', async (action) => {
      await runTurn({ usage_limit_action: action }, [overageOn, assistant('a', 1000), done]);
      expect(reasonOf()).toBe('overage_disabled');
    });

    it('continue + unlimited: overage runs to completion and the spend is recorded', async () => {
      const row = await runTurn({ usage_limit_action: 'continue', usage_limit: null }, [
        overageOn,
        assistant('a', 1_000_000),
        done,
      ]);
      expect(mockApp._onUsageLimit).not.toHaveBeenCalled();
      expect(row.usage_limit_spent).toBeGreaterThan(1);
    });

    it('continue + under the cap: completes and records the spend', async () => {
      const row = await runTurn({ usage_limit_action: 'continue', usage_limit: 100 }, [
        overageOn,
        assistant('a', 20_000),
        done,
      ]);
      expect(mockApp._onUsageLimit).not.toHaveBeenCalled();
      expect(row.usage_limit_spent).toBeGreaterThan(0);
      expect(row.usage_limit_spent).toBeLessThan(1);
    });

    it('continue + over the cap: stops with the session usage limit and records the spend', async () => {
      const row = await runTurn({ usage_limit_action: 'continue', usage_limit: 1 }, [
        overageOn,
        assistant('a', 1_000_000),
        done,
      ]);
      expect(reasonOf()).toBe('usage_limit');
      expect(row.usage_limit_spent).toBeGreaterThan(1);
    });

    it('continue: spend from earlier turns counts toward the cap', async () => {
      await runTurn({ usage_limit_action: 'continue', usage_limit: 1, usage_limit_spent: 0.9 }, [
        overageOn,
        assistant('a', 20_000),
        done,
      ]);
      expect(reasonOf()).toBe('usage_limit');
    });

    it('records the usage of a turn cut mid-stream by the cap', async () => {
      await runTurn({ usage_limit_action: 'continue', usage_limit: 1 }, [
        overageOn,
        assistant('a', 1_000_000),
      ]);
      await vi.waitFor(() => expect(mockApp._insertUsageRow).toHaveBeenCalled());
      expect(mockApp._insertUsageRow.mock.calls[0][1]).toMatchObject({ output_tokens: 1_000_000 });
    });
  });

  describe('handleMessageCreated', () => {
    it('does nothing for non-user messages', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      const createAgentSessionSpy = vi
        .spyOn(service, 'createAgentSession')
        .mockResolvedValue({ channel: { push: vi.fn() } });

      await service.handleMessageCreated({
        session_id: BASE_SESSION_ID,
        type: 'assistant',
        message_json: '{}',
      });

      expect(createAgentSessionSpy).not.toHaveBeenCalled();
    });

    it('pushes to active session channel when user message and session already active', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      query.mockImplementation(() => makeNeverEndingIterable());
      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      const active = service.getActiveSession(BASE_SESSION_ID);
      const pushSpy = vi.spyOn(active.channel, 'push');

      const userMsg = { type: 'user', message: { role: 'user', content: 'Hi' } };
      await service.handleMessageCreated({
        session_id: BASE_SESSION_ID,
        agent_id: BASE_BUILDER.id,
        agent_type: 'builder',
        agent_sdk: 'claude',
        type: 'user',
        message_json: JSON.stringify(userMsg),
      });

      expect(pushSpy).toHaveBeenCalledWith(userMsg);
    });

    it('does not push persisted tool_result user rows back into the agent channel', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      query.mockImplementation(() => makeNeverEndingIterable());
      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      const active = service.getActiveSession(BASE_SESSION_ID);
      const pushSpy = vi.spyOn(active.channel, 'push');

      const toolResultMsg = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }],
        },
      };
      await service.handleMessageCreated({
        session_id: BASE_SESSION_ID,
        agent_id: BASE_BUILDER.id,
        agent_type: 'builder',
        agent_sdk: 'claude',
        type: 'user',
        message_json: JSON.stringify(toolResultMsg),
      });

      expect(pushSpy).not.toHaveBeenCalled();
    });

    it('pushes baguette-sourced user messages to the active session channel', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      query.mockImplementation(() => makeNeverEndingIterable());
      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow, BASE_BUILDER, {
        model: BASE_BUILDER.model,
        turnAgentConfigId: BASE_BUILDER.agent_config_id,
      });

      const active = service.getActiveSession(BASE_SESSION_ID);
      const pushSpy = vi.spyOn(active.channel, 'push');

      const baguetteMsg = {
        type: 'user',
        source: 'baguette',
        title: 'Syncing with remote',
        message: { role: 'user', content: 'Please pull.' },
      };
      await service.handleMessageCreated({
        session_id: BASE_SESSION_ID,
        agent_id: BASE_BUILDER.id,
        agent_type: 'builder',
        agent_sdk: 'claude',
        type: 'user',
        subtype: 'baguette',
        message_json: JSON.stringify(baguetteMsg),
      });

      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(pushSpy).toHaveBeenCalledWith(baguetteMsg);
    });

    it('calls createAgentSession when user message and session has no claude_session_id', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      const userMsg = { type: 'user', message: { role: 'user', content: 'Start' } };
      await service.handleMessageCreated({
        session_id: BASE_SESSION_ID,
        agent_id: BASE_BUILDER.id,
        agent_type: 'builder',
        agent_sdk: 'claude',
        type: 'user',
        model: 'sonnet',
        agent_config_id: BASE_BUILDER.agent_config_id,
        message_json: JSON.stringify(userMsg),
      });

      expect(query).toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(service.getActiveSession(BASE_SESSION_ID)).toBeUndefined();
      });
    });

    it('starts the query with the message model and leaves the session model unchanged', async () => {
      await db('agents').where({ id: BASE_BUILDER.id }).update({ model: 'opus' });
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      let capturedOptions;
      query.mockImplementation(({ options }) => {
        capturedOptions = options;
        return makeAsyncIterable([]);
      });

      await service.handleMessageCreated({
        session_id: BASE_SESSION_ID,
        agent_id: BASE_BUILDER.id,
        agent_type: 'builder',
        agent_sdk: 'claude',
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Start' } }),
        model: 'sonnet',
        agent_config_id: BASE_BUILDER.agent_config_id,
      });

      expect(capturedOptions.model).toBe('sonnet');
      expect((await db('agents').where({ id: BASE_BUILDER.id }).first()).model).toBe('opus');
      await vi.waitFor(() => {
        expect(service.getActiveSession(BASE_SESSION_ID)).toBeUndefined();
      });
    });

    it('refuses to start a turn when the message has no model snapshot', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      const createAgentSessionSpy = vi
        .spyOn(service, 'createAgentSession')
        .mockResolvedValue({ channel: { push: vi.fn() } });

      await expect(
        service.handleMessageCreated({
          session_id: BASE_SESSION_ID,
          agent_id: BASE_BUILDER.id,
          type: 'user',
          message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
        })
      ).rejects.toThrow('Message is missing model for this turn (claude)');

      expect(createAgentSessionSpy).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });

    it('refuses to start a turn whose message names a missing agent config', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      await expect(
        service.handleMessageCreated({
          session_id: BASE_SESSION_ID,
          agent_id: BASE_BUILDER.id,
          type: 'user',
          model: 'sonnet',
          agent_config_id: 9999,
          message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
        })
      ).rejects.toThrow('Agent configuration not found');

      expect(query).not.toHaveBeenCalled();
    });

    it('refuses to start a turn when the message has no agent config', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      const createAgentSessionSpy = vi
        .spyOn(service, 'createAgentSession')
        .mockResolvedValue({ channel: { push: vi.fn() } });

      await expect(
        service.handleMessageCreated({
          session_id: BASE_SESSION_ID,
          agent_id: BASE_BUILDER.id,
          type: 'user',
          model: 'sonnet',
          message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
        })
      ).rejects.toThrow('Agent configuration is required to run this turn');

      expect(createAgentSessionSpy).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });
  });

  // ── 7. injectBaguetteMessage ───────────────────────────────────────────────

  describe('injectBaguetteMessage', () => {
    it('tags the message as baguette-sourced so the chat does not show it as the user typing', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      const channel = { push: vi.fn() };

      await service.injectBaguetteMessage(
        { sessionId: BASE_SESSION_ID, channel },
        { title: 'Syncing with remote', content: 'Please pull the latest changes.' }
      );

      const [persisted] = mockApp._messageCreate.mock.calls[0];
      expect(persisted.subtype).toBe('baguette');
      const parsed = JSON.parse(persisted.message_json);
      expect(parsed.source).toBe('baguette');
      expect(parsed.title).toBe('Syncing with remote');
      expect(parsed.content).toBe('Please pull the latest changes.');

      // Delivery to the agent is via messages `created` → handleMessageCreated, not a direct push.
      expect(channel.push).not.toHaveBeenCalled();
    });
  });

  // ── 7. Metadata generation ─────────────────────────────────────────────────

  describe('completeText', () => {
    const SUCCESS_RESULT = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Fix login redirect',
    };

    function makeService() {
      return Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
    }

    it('returns the raw completion text and runs the requested model', async () => {
      query.mockImplementation(() => makeAsyncIterable([SUCCESS_RESULT]));

      const service = makeService();
      const text = await service.completeText('Generate a title', {
        userId: 1,
        model: 'claude-opus-5',
      });

      expect(text).toBe('Fix login redirect');
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0].options.model).toBe('claude-opus-5');
    });

    it('falls back to the cheap alias when no model is requested', async () => {
      query.mockImplementation(() => makeAsyncIterable([SUCCESS_RESULT]));

      const service = makeService();
      await service.completeText('Generate a title', { userId: 1, model: null });

      expect(query.mock.calls[0][0].options.model).toBe('haiku');
    });

    it('returns empty text when the result is an error', async () => {
      query.mockImplementation(() =>
        makeAsyncIterable([
          { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'nope' },
        ])
      );

      const service = makeService();
      const text = await service.completeText('Generate a title', { userId: 1 });
      expect(text).toBe('');
    });
  });
});
