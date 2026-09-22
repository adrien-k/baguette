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

vi.mock('../../db.js', () => ({ default: vi.fn() }));

vi.mock('../github.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    getOpenPR: vi.fn(),
    remoteHasNewCommits: vi.fn(),
  };
});

vi.mock('../agent-settings.js', () => ({
  getAllowedCommandsFromUser: vi.fn().mockReturnValue([]),
  getEffectiveGithubToken: vi.fn((user) => user?.access_token || null),
}));

vi.mock('../baguette-config.js', () => ({
  loadBaguetteConfig: vi.fn(),
  interpolateEnv: vi.fn(),
  getScriptBlock: vi.fn(),
}));

vi.mock('../baguette-mcp-server.js', () => ({
  buildBaguetteMcpServer: vi.fn(() => ({})),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb(null, { stdout: '', stderr: '' })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import path from 'path';
import { createTestDb } from '../../test-utils/db.js';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { loadBaguetteConfig } from '../baguette-config.js';

import { REPOS_DIR } from '../../config.js';
import { ClaudeAgentService } from '../feathers/claude-agent.service.js';

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
  const sessionRemove = vi.fn().mockResolvedValue({});
  const sessionEmit = vi.fn();
  const messageCreate = vi.fn().mockResolvedValue({ id: 1 });
  const genericRemove = vi.fn().mockResolvedValue({});
  const getClaudeEnv = vi.fn().mockResolvedValue({});
  const deleteSessionTasks = vi.fn();
  const createTask = vi.fn().mockResolvedValue({});

  return {
    get: function (key) {
      if (key === 'db') return db;
    },
    service: vi.fn((name) => {
      if (name === 'sessions')
        return {
          patch: sessionPatch,
          remove: sessionRemove,
          emit: sessionEmit,
          getClaudeEnv,
          get: async (id) => db('sessions').where({ id }).first(),
        };
      if (name === 'messages') return { create: messageCreate, remove: genericRemove };
      if (name === 'tasks') return { create: createTask, deleteSessionTasks };
      if (name === 'users')
        return { get: vi.fn().mockResolvedValue({ id: 1, github_token: 'tok' }) };
      return { patch: vi.fn(), create: vi.fn(), remove: genericRemove };
    }),
    // Exposed for assertions
    _sessionPatch: sessionPatch,
    _sessionRemove: sessionRemove,
    _sessionEmit: sessionEmit,
    _messageCreate: messageCreate,
  };
}

const BASE_SESSION_DATA = {
  user_id: 1,
  short_id: 'abc12',
  repo_full_name: 'owner/repo',
  base_branch: 'main',
  initial_prompt: 'Fix the bug',
  permission_mode: 'default',
  plan_mode: false,
  model: null,
  // Must follow REPOS_DIR/<stripped>/sessions/<id> so createCanUseTool can derive the repo dir
  worktree_path: path.join(REPOS_DIR, 'owner-repo', 'sessions', 'test-session'),
  repo_id: 7,
  remote_branch: null,
  claude_session_id: null,
  status: 'active',
};
let BASE_SESSION_ID; // auto-generated integer id, set in beforeEach

const BASE_USER = { id: 1, github_id: 1, username: 'test' };

const BASE_REPO = {
  id: 7,
  full_name: 'owner/repo',
  bare_path: '/data/repos/owner-repo',
  stripped_name: 'owner-repo',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ClaudeAgentService', (hooks) => {
  const db = createTestDb(hooks);
  let mockApp;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockApp = makeMockApp(db);

    await db('users').insert(BASE_USER);
    await db('repos').insert(BASE_REPO);
    [BASE_SESSION_ID] = await db('sessions').insert(BASE_SESSION_DATA);

    // Default mocks
    loadBaguetteConfig.mockResolvedValue(null);

    // Use mockImplementation so each query() call gets a fresh iterable
    query.mockImplementation(() => makeAsyncIterable([]));
  });

  // ── 1. Session creation ────────────────────────────────────────────────────

  describe('createAgentSession', () => {
    it('starts the query loop with cwd pointing at the worktree, sets status to running', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      const sessionState = await service.createAgentSession(sessionRow);

      // query() started with cwd pointing at the worktree
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            cwd: path.join(REPOS_DIR, 'owner-repo', 'sessions', 'test-session'),
          }),
        })
      );

      // Status patched to 'running'
      expect(mockApp._sessionPatch).toHaveBeenCalledWith(BASE_SESSION_ID, { status: 'running' });

      // Session state returned
      expect(sessionState.sessionId).toBe(BASE_SESSION_ID);
      expect(sessionState.absoluteWorktreePath).toBe(
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
      await service.createAgentSession(sessionRow);

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
      await service.createAgentSession(sessionRow);

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
      const sessionState = await service.createAgentSession(sessionRow);

      await vi.waitFor(() => {
        expect(sessionState.claudeSessionId).toBe('claude-xyz');
      });
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
      await service.createAgentSession(sessionRow);

      await vi.waitFor(() => {
        expect(mockApp._sessionPatch).toHaveBeenCalledWith(
          BASE_SESSION_ID,
          { status: 'completed' },
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
      await service.createAgentSession(sessionRow);

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
      await service.createAgentSession(sessionRow);

      // The task_notification message must have been persisted (loop stayed open past result)
      await vi.waitFor(() => {
        expect(mockApp._messageCreate).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'system', subtype: 'task_notification' }),
          expect.anything()
        );
      });

      // Status reached completed (set at result time), then running (awaiting auto-resume)
      expect(mockApp._sessionPatch).toHaveBeenCalledWith(
        BASE_SESSION_ID,
        { status: 'completed' },
        expect.anything()
      );
      expect(mockApp._sessionPatch).toHaveBeenCalledWith(
        BASE_SESSION_ID,
        { status: 'running' },
        expect.anything()
      );
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
      await service.createAgentSession(sessionRow);

      // The assistant message from the auto-continuation must be persisted
      await vi.waitFor(() => {
        expect(mockApp._messageCreate).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'assistant' }),
          expect.anything()
        );
      });

      // Session must end up completed (from the second result)
      const patchCalls = mockApp._sessionPatch.mock.calls;
      const lastStatusPatch = [...patchCalls].reverse().find(([, patch]) => patch.status);
      expect(lastStatusPatch[1]).toEqual({ status: 'completed' });

      // Status was set to running when task_notification arrived (before auto-continuation)
      expect(mockApp._sessionPatch).toHaveBeenCalledWith(
        BASE_SESSION_ID,
        { status: 'running' },
        expect.anything()
      );
    });
    it('does not restart the turn on intermediate task_notification events (non-terminal status)', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      // Intermediate notifications (status !== 'completed'/'failed'/'error') must not trigger
      // awaitingAutoResume or a status: 'running' patch. Only the final 'completed' one should.
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
        // Final terminal notification — this one should trigger awaitingAutoResume
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
      await service.createAgentSession(sessionRow);

      await vi.waitFor(() => {
        // All three task_notification messages must be persisted
        const notifCalls = mockApp._messageCreate.mock.calls.filter(
          ([msg]) => msg.subtype === 'task_notification'
        );
        expect(notifCalls).toHaveLength(3);
      });

      // status: 'running' must be patched exactly twice: once at session start (createAgentSession)
      // and once for the terminal task_notification — never for intermediate notifications.
      const runningPatches = mockApp._sessionPatch.mock.calls.filter(
        ([, patch]) => patch.status === 'running'
      );
      expect(runningPatches).toHaveLength(2);

      // Session must end completed
      const patchCalls = mockApp._sessionPatch.mock.calls;
      const lastStatusPatch = [...patchCalls].reverse().find(([, patch]) => patch.status);
      expect(lastStatusPatch[1]).toEqual({ status: 'completed' });
    });
  });

  // ── 5. Assistant failure ───────────────────────────────────────────────────

  describe('assistant failure', () => {
    it('patches session status to failed when result has is_error=true', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      query.mockImplementation(() =>
        makeAsyncIterable([{ type: 'result', subtype: 'error', is_error: true }])
      );

      const sessionRow = await db('sessions').where({ id: BASE_SESSION_ID }).first();
      await service.createAgentSession(sessionRow);

      await vi.waitFor(() => {
        expect(mockApp._sessionPatch).toHaveBeenCalledWith(
          BASE_SESSION_ID,
          { status: 'failed' },
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
      await service.createAgentSession(sessionRow);

      await vi.waitFor(() => {
        expect(mockApp._sessionPatch).toHaveBeenCalledWith(
          BASE_SESSION_ID,
          { status: 'failed' },
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
            type: 'system',
            subtype: 'status',
            message_json: expect.stringContaining('Stream broken'),
          }),
          expect.anything()
        );
      });
    });
  });

  // ── 6. onMessageCreated (imperative callback) ───────────────────────────────

  describe('onMessageCreated', () => {
    it('does nothing for non-user messages', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });
      const createAgentSessionSpy = vi
        .spyOn(service, 'createAgentSession')
        .mockResolvedValue({ channel: { push: vi.fn() } });

      await service.onMessageCreated({
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
      await service.createAgentSession(sessionRow);

      const active = service.getActiveSession(BASE_SESSION_ID);
      const pushSpy = vi.spyOn(active.channel, 'push');

      const userMsg = { type: 'user', message: { role: 'user', content: 'Hi' } };
      await service.onMessageCreated({
        session_id: BASE_SESSION_ID,
        type: 'user',
        message_json: JSON.stringify(userMsg),
      });

      expect(pushSpy).toHaveBeenCalledWith(userMsg);
    });

    it('calls createAgentSession when user message and session has no claude_session_id', async () => {
      const service = Object.assign(new ClaudeAgentService(), {
        app: mockApp,
        _db: mockApp.get('db'),
      });

      const userMsg = { type: 'user', message: { role: 'user', content: 'Start' } };
      await service.onMessageCreated({
        session_id: BASE_SESSION_ID,
        type: 'user',
        message_json: JSON.stringify(userMsg),
      });

      expect(query).toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(service.getActiveSession(BASE_SESSION_ID)).toBeUndefined();
      });
    });
  });
});
