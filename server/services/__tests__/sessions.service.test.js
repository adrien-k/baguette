/**
 * Integration tests for the sessions Feathers service.
 *
 * Two describe blocks share the same module-level mocks but use independent
 * in-memory SQLite databases so their setups don't interfere:
 *
 *  1. "custom methods" - stop, commands, remove
 *     All methods now accept integer session id; user scoping is enforced via DB queries.
 *
 *  2. "find, get, create" - standard CRUD with real seeded rows.
 *     Uses a stub messages service so createFirstMessage stays isolated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { NotFound } from '@feathersjs/errors';
import { createTestDb } from '../../test-utils/db.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerReposService } from '../feathers/repos.service.js';
import { createWorktree, getOpenPR, getPRStatus, removeWorktree } from '../github.js';

// ── Module-level mocks ────────────────────────────────────────────────────────

const {
  stopSession,
  onMessageCreated,
  syncSessionSettingsFromPatch,
  loadBaguetteConfig,
  generateSessionMetadata,
  buildSystemPromptAppend,
  deleteAgent,
} = vi.hoisted(() => ({
  stopSession: vi.fn().mockResolvedValue(undefined),
  onMessageCreated: vi.fn().mockResolvedValue(undefined),
  syncSessionSettingsFromPatch: vi.fn(),
  loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  generateSessionMetadata: vi
    .fn()
    .mockResolvedValue({ label: 'Test task', branchName: 'test-task-abc' }),
  buildSystemPromptAppend: vi.fn().mockResolvedValue('mocked builder system prompt'),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb(null, { stdout: '', stderr: '' })),
}));

vi.mock('../github.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    createWorktree: vi.fn().mockResolvedValue({ worktreePath: '/tmp/test-worktree' }),
    getOpenPRByNumber: vi.fn(),
    getOpenPR: vi.fn().mockResolvedValue(null),
    getPRStatus: vi.fn().mockResolvedValue('open'),
  };
});

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig,
  };
});

vi.mock('../session-prompt.js', () => ({
  buildSystemPromptAppend,
}));

// ── Shared helpers ────────────────────────────────────────────────────────────

const params = (user) => ({ provider: 'rest', user });

const cursorOnMessageCreated = vi.fn().mockResolvedValue(undefined);
const deleteSessionTasks = vi.fn();
const usersServiceGet = vi.fn().mockResolvedValue({ id: 1, access_token: 'test-token' });
// Not Feathers methods (like the real service): called directly by sessions.service.
const findRunningTask = vi.fn().mockReturnValue(null);
const tasksCreate = vi.fn(async (data) => ({ id: 42, ...data }));
const getTask = vi.fn().mockReturnValue(null);

function makeApp(db) {
  const app = feathers();
  app.set('db', db);
  app.use(
    'tasks',
    {
      deleteSessionTasks,
      create: tasksCreate,
      _findRunningTask: findRunningTask,
      getTask,
    },
    { methods: ['deleteSessionTasks', 'create'] }
  );
  app.use(
    'claude-agent',
    {
      stopSession,
      onMessageCreated,
      syncSessionSettingsFromPatch,
      generateSessionMetadata,
    },
    {
      methods: [
        'stopSession',
        'onMessageCreated',
        'syncSessionSettingsFromPatch',
        'generateSessionMetadata',
      ],
    }
  );
  app.use(
    'cursor-agent',
    { stopSession, deleteAgent, generateSessionMetadata, onMessageCreated: cursorOnMessageCreated },
    { methods: ['stopSession', 'deleteAgent', 'generateSessionMetadata', 'onMessageCreated'] }
  );
  app.use('users', { get: usersServiceGet }, { methods: ['get'] });
  registerSessionsService(app);
  registerMessagesService(app);
  return app;
}

async function seedUserAndSession(db, { github_id, username, shortId, worktreePath = null } = {}) {
  await db('users').insert({ github_id, username, approved: true });
  const user = await db('users').where({ username }).first();

  await db('repos')
    .insert({ full_name: 'test/repo', bare_path: '/tmp/repo' })
    .onConflict('full_name')
    .ignore();
  const repo = await db('repos').where({ full_name: 'test/repo' }).first();

  const [sessId] = await db('sessions').insert({
    user_id: user.id,
    repo_id: repo.id,
    repo_full_name: 'test/repo',
    base_branch: 'main',
    initial_prompt: `Task for ${username}`,
    short_id: shortId,
    status: 'active',
    worktree_path: worktreePath,
  });

  return { user, repo, sessId };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Custom methods: stop, commands, remove
// ─────────────────────────────────────────────────────────────────────────────

describe('Sessions service - custom methods', (hooks) => {
  const db = createTestDb(hooks);

  let app;
  let userId;
  let otherUserId;
  let sessId;

  beforeEach(async () => {
    vi.clearAllMocks();
    stopSession.mockResolvedValue(undefined);
    loadBaguetteConfig.mockResolvedValue(null);

    const result = await seedUserAndSession(db, {
      github_id: 1001,
      username: 'alice',
      shortId: 'abc123',
      worktreePath: '/tmp/wt',
    });
    userId = result.user.id;
    sessId = result.sessId;

    await db('users').insert({
      github_id: 1002,
      username: 'bob',
      approved: true,
    });
    otherUserId = (await db('users').where({ username: 'bob' }).first()).id;

    app = makeApp(db);
    await app.setup();
  });

  // ── stop ───────────────────────────────────────────────────────────────────

  describe('stop', () => {
    it('stops session, updates status to stopped, returns { ok: true }', async () => {
      const result = await app.service('sessions').stop(sessId, params({ id: userId }));

      expect(stopSession).toHaveBeenCalledWith(sessId, expect.anything());
      expect(result).toEqual({ ok: true });
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.status).toBe('stopped');
    });

    it('rejects with NotFound for an unknown id', async () => {
      await expect(
        app.service('sessions').stop(99999, params({ id: userId }))
      ).rejects.toBeInstanceOf(NotFound);
    });

    it('rejects with NotFound when session belongs to another user', async () => {
      await expect(
        app.service('sessions').stop(sessId, params({ id: otherUserId }))
      ).rejects.toBeInstanceOf(NotFound);
    });

    it('rejects when not authenticated', async () => {
      await expect(app.service('sessions').stop(sessId, { provider: 'rest' })).rejects.toThrow(
        'Not authenticated'
      );
    });
  });

  // ── commands ───────────────────────────────────────────────────────────────

  describe('commands', () => {
    it('returns empty commands when host config is null', async () => {
      const result = await app.service('sessions').commands(sessId, params({ id: userId }));

      expect(loadBaguetteConfig).toHaveBeenCalledWith('/tmp/wt');
      expect(result).toEqual({ commands: [] });
    });

    it('returns commands from host config', async () => {
      loadBaguetteConfig.mockResolvedValue({
        session: {
          commands: [
            { label: 'Run tests', run: 'npm test' },
            { label: 'Lint', run: 'npm run lint' },
          ],
        },
      });

      const result = await app.service('sessions').commands(sessId, params({ id: userId }));

      expect(result).toEqual({
        commands: [
          { label: 'Run tests', run: 'npm test' },
          { label: 'Lint', run: 'npm run lint' },
        ],
      });
    });

    it('returns empty commands when session has no worktree_path', async () => {
      const [sessId2] = await db('sessions').insert({
        user_id: userId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'no wt',
        short_id: 'nowt11',
        status: 'active',
        worktree_path: null,
      });

      const result = await app.service('sessions').commands(sessId2, params({ id: userId }));

      expect(loadBaguetteConfig).not.toHaveBeenCalled();
      expect(result).toEqual({ commands: [] });
    });

    it('rejects with NotFound for an unknown id', async () => {
      await expect(
        app.service('sessions').commands(99999, params({ id: userId }))
      ).rejects.toBeInstanceOf(NotFound);
    });

    it('rejects with NotFound when session belongs to another user', async () => {
      await expect(
        app.service('sessions').commands(sessId, params({ id: otherUserId }))
      ).rejects.toBeInstanceOf(NotFound);
    });
  });

  // ── startPreviewService ────────────────────────────────────────────────────

  describe('startPreviewService', () => {
    beforeEach(() => {
      loadBaguetteConfig.mockResolvedValue({
        webserver: { command: 'npm start', ports: ['PORT'], expose: 'PORT' },
      });
      findRunningTask.mockReturnValue(null);
    });

    it('starts a webserver task for the default service', async () => {
      const result = await app
        .service('sessions')
        .startPreviewService({ id: sessId }, params({ id: userId }));

      expect(tasksCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: sessId,
          command: 'npm start',
          label: 'baguette:webserver:default',
          ports: ['PORT'],
        }),
        expect.anything()
      );
      expect(result.id).toBe(42);
    });

    it('clears then starts: stops the task already running for the service', async () => {
      const kill = vi.fn().mockResolvedValue(true);
      findRunningTask.mockReturnValue({ id: 7, ports: { PORT: 3000 }, kill });

      await app.service('sessions').startPreviewService({ id: sessId }, params({ id: userId }));

      expect(kill).toHaveBeenCalled();
      expect(tasksCreate).toHaveBeenCalledTimes(1);
    });

    it('rejects when the service is not configured', async () => {
      loadBaguetteConfig.mockResolvedValue({});

      await expect(
        app.service('sessions').startPreviewService({ id: sessId }, params({ id: userId }))
      ).rejects.toThrow('No preview service "default" configured');
    });

    it('rejects with NotFound when session belongs to another user', async () => {
      await expect(
        app.service('sessions').startPreviewService({ id: sessId }, params({ id: otherUserId }))
      ).rejects.toBeInstanceOf(NotFound);
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('stops agent, archives session, returns the session row', async () => {
      const result = await app.service('sessions').remove(sessId, params({ id: userId }));

      expect(stopSession).toHaveBeenCalledWith(sessId, expect.anything());
      expect(deleteSessionTasks).toHaveBeenCalledWith(sessId, expect.anything());
      expect(removeWorktree).toHaveBeenCalled();
      expect(result.id).toBe(sessId);
      expect(result.archived_at).toBeTruthy();
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.archived_at).toBeTruthy();
      expect(row.worktree_path).toBeNull();
    });

    it('sets archived_at only after removeWorktree runs', async () => {
      removeWorktree.mockImplementationOnce(async () => {
        const row = await db('sessions').where({ id: sessId }).first();
        expect(row.archived_at).toBeFalsy();
        expect(row.status).toBe('archiving');
      });

      await app.service('sessions').remove(sessId, params({ id: userId }));
    });

    it('rejects a second archive while one is in progress', async () => {
      let resolveRemove;
      const removing = new Promise((resolve) => {
        resolveRemove = resolve;
      });
      removeWorktree.mockImplementationOnce(() => removing);

      try {
        const first = app.service('sessions').remove(sessId, params({ id: userId }));
        await vi.waitFor(async () => {
          const row = await db('sessions').where({ id: sessId }).first();
          expect(row.status).toBe('archiving');
        });
        await expect(
          app.service('sessions').remove(sessId, params({ id: userId }))
        ).rejects.toThrow(/already being archived/);
        resolveRemove();
        await first;
      } finally {
        resolveRemove?.();
      }
    });

    it('rejects archive while the session is still provisioning', async () => {
      await db('sessions').where({ id: sessId }).update({ status: 'provisioning' });

      await expect(app.service('sessions').remove(sessId, params({ id: userId }))).rejects.toThrow(
        /still being set up/
      );

      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.archived_at).toBeFalsy();
      expect(row.status).toBe('provisioning');
      expect(removeWorktree).not.toHaveBeenCalled();
    });

    it('removes worktree by short_id when worktree_path is not set yet', async () => {
      await db('sessions').where({ id: sessId }).update({
        worktree_path: null,
        short_id: 'deadbeef',
        status: 'stopped',
      });

      await app.service('sessions').remove(sessId, params({ id: userId }));

      expect(removeWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ id: sessId, short_id: 'deadbeef', worktree_path: null }),
        expect.objectContaining({ full_name: 'test/repo' })
      );
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.archived_at).toBeTruthy();
    });

    it('rejects with NotFound for an unknown id', async () => {
      await expect(
        app.service('sessions').remove(99999, params({ id: userId }))
      ).rejects.instanceOf(NotFound);
    });

    it('rejects with NotFound when session belongs to another user', async () => {
      await expect(
        app.service('sessions').remove(sessId, params({ id: otherUserId }))
      ).rejects.instanceOf(NotFound);
    });

    it('rejects when not authenticated', async () => {
      await expect(app.service('sessions').remove(sessId, { provider: 'rest' })).rejects.toThrow(
        'Not authenticated'
      );
    });

    it('deletes cursor agent when archiving a cursor session', async () => {
      const cursorAgentId = 'test-cursor-agent-id';
      await db('sessions').where({ id: sessId }).update({
        agent_sdk: 'cursor',
        cursor_agent_id: cursorAgentId,
      });

      await app.service('sessions').remove(sessId, params({ id: userId }));

      expect(deleteAgent).toHaveBeenCalledWith(
        expect.objectContaining({ id: sessId, cursor_agent_id: cursorAgentId }),
        expect.anything()
      );
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.archived_at).toBeTruthy();
    });

    it('does not call deleteAgent for claude sessions', async () => {
      await app.service('sessions').remove(sessId, params({ id: userId }));

      expect(deleteAgent).not.toHaveBeenCalled();
    });
  });

  // ── removeByRepoId ─────────────────────────────────────────────────────────

  describe('removeByRepoId', () => {
    it('stops and soft-deletes all non-deleted sessions for the repo', async () => {
      const repo = await db('repos').where({ full_name: 'test/repo' }).first();

      const [sess2] = await db('sessions').insert({
        user_id: userId,
        repo_id: repo.id,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'second task',
        short_id: 'xyz789',
        status: 'stopped',
        worktree_path: null,
      });

      await app.service('sessions').removeByRepoId(repo.id);

      expect(stopSession).toHaveBeenCalledWith(sessId, expect.anything());
      expect(stopSession).toHaveBeenCalledWith(sess2, expect.anything());

      const s1 = await db('sessions').where({ id: sessId }).first();
      const s2 = await db('sessions').where({ id: sess2 }).first();
      expect(s1.archived_at).toBeTruthy();
      expect(s2.archived_at).toBeTruthy();
    });

    it('skips already soft-deleted sessions', async () => {
      const repo = await db('repos').where({ full_name: 'test/repo' }).first();
      await db('sessions').where({ id: sessId }).update({ archived_at: new Date().toISOString() });

      await app.service('sessions').removeByRepoId(repo.id);

      expect(stopSession).not.toHaveBeenCalled();
    });

    it('does nothing when the repo has no sessions', async () => {
      const [repoId] = await db('repos').insert({
        full_name: 'empty/repo',
        bare_path: '/tmp/empty',
      });

      await expect(app.service('sessions').removeByRepoId(repoId)).resolves.toBeUndefined();

      expect(stopSession).not.toHaveBeenCalled();
    });

    it('archives all users sessions when no user scope is passed (global repo delete)', async () => {
      const repo = await db('repos').where({ full_name: 'test/repo' }).first();

      const [otherSessId] = await db('sessions').insert({
        user_id: otherUserId,
        repo_id: repo.id,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'bob task',
        short_id: 'bob123',
        status: 'stopped',
        worktree_path: null,
      });

      await app.service('sessions').removeByRepoId(repo.id);

      const alice = await db('sessions').where({ id: sessId }).first();
      const bob = await db('sessions').where({ id: otherSessId }).first();
      expect(alice.archived_at).toBeTruthy();
      expect(bob.archived_at).toBeTruthy();
      expect(stopSession).toHaveBeenCalledWith(otherSessId, expect.anything());
    });

    it('archives only the scoped user sessions (repo unlink)', async () => {
      const repo = await db('repos').where({ full_name: 'test/repo' }).first();

      const [otherSessId] = await db('sessions').insert({
        user_id: otherUserId,
        repo_id: repo.id,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'bob task',
        short_id: 'bob123',
        status: 'stopped',
        worktree_path: null,
      });

      await app.service('sessions').removeByRepoId(repo.id, { user: { id: userId } });

      const alice = await db('sessions').where({ id: sessId }).first();
      const bob = await db('sessions').where({ id: otherSessId }).first();
      expect(alice.archived_at).toBeTruthy();
      expect(bob.archived_at).toBeFalsy();
      expect(stopSession).not.toHaveBeenCalledWith(otherSessId, expect.anything());
    });

    it('internal remove can archive another user session when provider is omitted', async () => {
      const [otherSessId] = await db('sessions').insert({
        user_id: otherUserId,
        repo_id: (await db('repos').where({ full_name: 'test/repo' }).first()).id,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'bob task',
        short_id: 'bob456',
        status: 'stopped',
        worktree_path: null,
      });

      await app.service('sessions').remove(otherSessId, { user: { id: userId } });

      const row = await db('sessions').where({ id: otherSessId }).first();
      expect(row.archived_at).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Repos unlink — session scope (real sessions + repos services)
// ─────────────────────────────────────────────────────────────────────────────

describe('Repos service - unlink', (hooks) => {
  const db = createTestDb(hooks);

  let app;
  let userId;
  let otherUserId;
  let repoId;
  let aliceSessId;
  let bobSessId;

  beforeEach(async () => {
    vi.clearAllMocks();
    stopSession.mockResolvedValue(undefined);
    loadBaguetteConfig.mockResolvedValue(null);

    const result = await seedUserAndSession(db, {
      github_id: 1001,
      username: 'alice',
      shortId: 'abc123',
    });
    userId = result.user.id;
    repoId = result.repo.id;
    aliceSessId = result.sessId;

    await db('users').insert({
      github_id: 1002,
      username: 'bob',
      approved: true,
    });
    otherUserId = (await db('users').where({ username: 'bob' }).first()).id;

    await db('user_repos').insert([
      { user_id: userId, repo_id: repoId },
      { user_id: otherUserId, repo_id: repoId },
    ]);

    [bobSessId] = await db('sessions').insert({
      user_id: otherUserId,
      repo_id: repoId,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'bob task',
      short_id: 'bob123',
      status: 'stopped',
      worktree_path: null,
    });

    app = makeApp(db);
    registerReposService(app);
    await app.setup();
  });

  it('does not archive another user sessions on the same repo', async () => {
    await app.service('repos').unlink(repoId, params({ id: userId }));

    const alice = await db('sessions').where({ id: aliceSessId }).first();
    const bob = await db('sessions').where({ id: bobSessId }).first();
    expect(alice.archived_at).toBeTruthy();
    expect(bob.archived_at).toBeFalsy();

    const aliceLink = await db('user_repos').where({ user_id: userId, repo_id: repoId }).first();
    expect(aliceLink).toBeUndefined();
    const bobLink = await db('user_repos').where({ user_id: otherUserId, repo_id: repoId }).first();
    expect(bobLink).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Standard CRUD: find, get, create
// ─────────────────────────────────────────────────────────────────────────────

function sessionData(overrides = {}) {
  return {
    repo_full_name: 'test/repo',
    base_branch: 'main',
    initial_prompt: 'Fix the bug',
    ...overrides,
  };
}

describe('Sessions service - find, get, create', (hooks) => {
  const db = createTestDb(hooks);

  let app;
  let repoId;
  let userId1;
  let userId2;
  let sessId1;
  let sessId2;

  beforeEach(async () => {
    vi.clearAllMocks();

    await db('users').insert([
      { github_id: 1001, username: 'alice', approved: true },
      { github_id: 1002, username: 'bob', approved: true },
    ]);
    userId1 = (await db('users').where({ username: 'alice' }).first()).id;
    userId2 = (await db('users').where({ username: 'bob' }).first()).id;

    await db('repos').insert({ full_name: 'test/repo', bare_path: '/tmp/repo' });
    repoId = (await db('repos').where({ full_name: 'test/repo' }).first()).id;

    [sessId1] = await db('sessions').insert({
      user_id: userId1,
      repo_id: repoId,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'Task for Alice',
      short_id: 'a1b2c3',
      status: 'active',
    });
    [sessId2] = await db('sessions').insert({
      user_id: userId2,
      repo_id: repoId,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'Task for Bob',
      short_id: 'd4e5f6',
      status: 'completed',
    });

    app = makeApp(db);
    await app.setup();
  });

  // ── find ───────────────────────────────────────────────────────────────────

  describe('find', () => {
    it('returns only sessions belonging to the authenticated user', async () => {
      const result = await app.service('sessions').find({ query: {}, ...params({ id: userId1 }) });

      const data = result.data ?? result;
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(sessId1);
      expect(data[0].user_id).toBe(userId1);
    });

    it('returns the correct sessions for each user independently', async () => {
      const r1 = await app.service('sessions').find({ query: {}, ...params({ id: userId1 }) });
      const r2 = await app.service('sessions').find({ query: {}, ...params({ id: userId2 }) });

      expect((r1.data ?? r1)[0].id).toBe(sessId1);
      expect((r2.data ?? r2)[0].id).toBe(sessId2);
    });

    it('returns empty list for a user with no sessions', async () => {
      await db('users').insert({
        github_id: 1003,
        username: 'carol',
        approved: true,
      });
      const carol = await db('users').where({ username: 'carol' }).first();

      const result = await app.service('sessions').find({ query: {}, ...params({ id: carol.id }) });

      expect(result.data ?? result).toHaveLength(0);
    });

    it('supports filtering by status within the user scope', async () => {
      await db('sessions').insert({
        user_id: userId1,
        repo_id: repoId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'Another task',
        short_id: 'x9y8z7',
        status: 'completed',
      });

      const result = await app.service('sessions').find({
        query: { status: 'completed' },
        ...params({ id: userId1 }),
      });

      const data = result.data ?? result;
      expect(data).toHaveLength(1);
      expect(data[0].status).toBe('completed');
    });

    it('can look up a session by short_id', async () => {
      const result = await app.service('sessions').find({
        query: { short_id: 'a1b2c3' },
        ...params({ id: userId1 }),
      });

      const data = result.data ?? result;
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(sessId1);
    });

    it('rejects when not authenticated', async () => {
      await expect(app.service('sessions').find({ query: {}, provider: 'rest' })).rejects.toThrow(
        'Not authenticated'
      );
    });
  });

  // ── get ────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns the session when it belongs to the user', async () => {
      const session = await app.service('sessions').get(sessId1, params({ id: userId1 }));

      expect(session.id).toBe(sessId1);
      expect(session.initial_prompt).toBe('Task for Alice');
    });

    it("throws NotFound when getting another user's session", async () => {
      await expect(
        app.service('sessions').get(sessId2, params({ id: userId1 }))
      ).rejects.instanceOf(NotFound);
    });

    it('throws NotFound for a non-existent id', async () => {
      await expect(app.service('sessions').get(99999, params({ id: userId1 }))).rejects.instanceOf(
        NotFound
      );
    });

    it('rejects when not authenticated', async () => {
      await expect(app.service('sessions').get(sessId1, { provider: 'rest' })).rejects.toThrow(
        'Not authenticated'
      );
    });

    it('triggers a background PR status refresh when session has a pr_number', async () => {
      await db('sessions')
        .where({ id: sessId1 })
        .update({ pr_number: 7, pr_status: 'open', repo_full_name: 'test/repo' });
      getPRStatus.mockResolvedValueOnce('closed');

      await app.service('sessions').get(sessId1, params({ id: userId1 }));

      // Wait for the background promise to settle
      await new Promise((r) => setTimeout(r, 0));

      expect(getPRStatus).toHaveBeenCalledWith('test-token', 'test/repo', 7);
      const row = await db('sessions').where({ id: sessId1 }).first();
      expect(row.pr_status).toBe('closed');
    });

    it('does not patch when PR status has not changed', async () => {
      await db('sessions')
        .where({ id: sessId1 })
        .update({ pr_number: 7, pr_status: 'open', repo_full_name: 'test/repo' });
      getPRStatus.mockResolvedValueOnce('open');

      await app.service('sessions').get(sessId1, params({ id: userId1 }));
      await new Promise((r) => setTimeout(r, 0));

      expect(getPRStatus).toHaveBeenCalled();
      const row = await db('sessions').where({ id: sessId1 }).first();
      expect(row.pr_status).toBe('open');
    });

    it('skips PR status refresh when pr_number is null', async () => {
      await app.service('sessions').get(sessId1, params({ id: userId1 }));
      await new Promise((r) => setTimeout(r, 0));

      expect(getPRStatus).not.toHaveBeenCalled();
    });

    it('skips PR status refresh when pr_status is already merged', async () => {
      await db('sessions').where({ id: sessId1 }).update({ pr_number: 7, pr_status: 'merged' });

      await app.service('sessions').get(sessId1, params({ id: userId1 }));
      await new Promise((r) => setTimeout(r, 0));

      expect(getPRStatus).not.toHaveBeenCalled();
    });
  });

  // ── preview_url visibility ─────────────────────────────────────────────────

  describe('preview_url', () => {
    beforeEach(async () => {
      // sessId1 already has worktree_path=null; give it one for preview tests
      await db('sessions').where({ id: sessId1 }).update({ worktree_path: '/tmp/wt-preview' });
    });

    it('is set when baguette config has a webserver block', async () => {
      loadBaguetteConfig.mockResolvedValue({
        webserver: { command: 'node server.js', ports: [3000] },
      });

      const session = await app.service('sessions').get(sessId1, params({ id: userId1 }));

      expect(session.preview_url).toBeTruthy();
      expect(session.preview_url).toContain('session-a1b2c3');
    });

    it('is set when baguette config has a services block (not just webserver)', async () => {
      loadBaguetteConfig.mockResolvedValue({
        services: { api: { task: 'server' } },
        session: { tasks: { server: { run: 'node api.js', ports: [4000] } } },
      });

      const session = await app.service('sessions').get(sessId1, params({ id: userId1 }));

      expect(session.preview_url).toBeTruthy();
      expect(session.preview_url).toContain('session-a1b2c3');
    });

    it('is false when baguette config has neither webserver nor services', async () => {
      loadBaguetteConfig.mockResolvedValue({ session: { tasks: { test: { run: 'npm test' } } } });

      const session = await app.service('sessions').get(sessId1, params({ id: userId1 }));

      expect(session.preview_url).toBeFalsy();
    });

    it('is false when config is null', async () => {
      loadBaguetteConfig.mockResolvedValue(null);

      const session = await app.service('sessions').get(sessId1, params({ id: userId1 }));

      expect(session.preview_url).toBeFalsy();
    });

    it('is false when session has no worktree_path', async () => {
      await db('sessions').where({ id: sessId2 }).update({ worktree_path: null });
      loadBaguetteConfig.mockResolvedValue({ webserver: { command: 'node server.js' } });

      const session = await app.service('sessions').get(sessId2, params({ id: userId2 }));

      expect(session.preview_url).toBeFalsy();
      expect(loadBaguetteConfig).not.toHaveBeenCalled();
    });
  });

  // ── patch ──────────────────────────────────────────────────────────────────

  describe('patch', () => {
    it('updates status on own session and returns the updated row', async () => {
      const session = await app
        .service('sessions')
        .patch(sessId1, { status: 'completed' }, params({ id: userId1 }));

      expect(session.id).toBe(sessId1);
      expect(session.status).toBe('completed');
    });

    it('calls claude-agent.syncSessionSettingsFromPatch after patch', async () => {
      await app
        .service('sessions')
        .patch(sessId1, { status: 'completed' }, params({ id: userId1 }));

      expect(syncSessionSettingsFromPatch).toHaveBeenCalledWith(
        sessId1,
        expect.objectContaining({ id: sessId1, status: 'completed' })
      );
    });

    it("throws NotFound when patching another user's session", async () => {
      await expect(
        app.service('sessions').patch(sessId2, { status: 'completed' }, params({ id: userId1 }))
      ).rejects.instanceOf(NotFound);
    });

    it('throws NotFound for a non-existent id', async () => {
      await expect(
        app.service('sessions').patch(99999, { status: 'completed' }, params({ id: userId1 }))
      ).rejects.instanceOf(NotFound);
    });

    it('rejects when not authenticated', async () => {
      await expect(
        app.service('sessions').patch(sessId1, { status: 'completed' }, { provider: 'rest' })
      ).rejects.toThrow('Not authenticated');
    });

    it('allows internal patch without user and avoids undefined user_id binding errors', async () => {
      const updated = await app.service('sessions').patch(sessId1, { status: 'completed' }, {});

      expect(updated.id).toBe(sessId1);
      expect(updated.status).toBe('completed');
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a session scoped to the authenticated user', async () => {
      const session = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));

      expect(session.user_id).toBe(userId1);
      expect(session.repo_full_name).toBe('test/repo');
      expect(session.base_branch).toBe('main');
    });

    it('auto-generates short_id if not provided', async () => {
      const data = sessionData({ repo_id: repoId });
      delete data.short_id;

      const session = await app.service('sessions').create(data, params({ id: userId1 }));

      expect(session.short_id).toBeTruthy();
      expect(session.short_id).toHaveLength(8);
    });

    it('ignores user_id in data and always uses the authenticated user', async () => {
      const session = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId, user_id: userId2 }), params({ id: userId1 }));

      expect(session.user_id).toBe(userId1);
    });

    it('persists the session so it can be retrieved via find', async () => {
      const created = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));

      const found = await app.service('sessions').find({
        query: { id: created.id },
        ...params({ id: userId1 }),
      });

      expect((found.data ?? found)[0].id).toBe(created.id);
    });

    it('emits a created event when a session is created', async () => {
      const createdHandler = vi.fn();
      app.service('sessions').on('created', createdHandler);

      const session = await app
        .service('sessions')
        .create(
          sessionData({ repo_id: repoId, initial_prompt: 'Hello world' }),
          params({ id: userId1 })
        );

      expect(createdHandler).toHaveBeenCalledTimes(1);
      const [createdResult] = createdHandler.mock.calls[0];
      expect(createdResult).toEqual(expect.objectContaining({ id: session.id }));
    });

    it('creates a first message when initial_prompt is provided', async () => {
      const createMessage = vi.fn().mockResolvedValue({ id: 99 });
      app.use('messages', { create: createMessage });

      await app
        .service('sessions')
        .create(
          sessionData({ repo_id: repoId, initial_prompt: 'Please add tests' }),
          params({ id: userId1 })
        );

      const userMsgCall = createMessage.mock.calls.find(([data]) => data.type === 'user');
      expect(userMsgCall).toBeTruthy();
      const parsed = JSON.parse(userMsgCall[0].message_json);
      expect(parsed.message.content).toBe('Please add tests');
    });

    it('does not create a first message when initial_prompt is empty', async () => {
      const createMessage = vi.fn().mockResolvedValue({ id: 99 });
      app.use('messages', { create: createMessage });

      const session = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId, initial_prompt: '' }), params({ id: userId1 }));

      const userMsgCall = createMessage.mock.calls.find(([data]) => data.type === 'user');
      expect(userMsgCall).toBeUndefined();
      expect(session.status).toBe('stopped');
    });

    it('does not create a first message when skipFirstMessage is set', async () => {
      const createMessage = vi.fn().mockResolvedValue({ id: 99 });
      app.use('messages', { create: createMessage });

      await app
        .service('sessions')
        .create(
          sessionData({ repo_id: repoId, initial_prompt: 'Fixture session', status: 'stopped' }),
          { ...params({ id: userId1 }), skipFirstMessage: true }
        );

      const userMsgCall = createMessage.mock.calls.find(([data]) => data.type === 'user');
      expect(userMsgCall).toBeUndefined();
    });

    it('rejects when not authenticated', async () => {
      await expect(
        app.service('sessions').create(sessionData(), { provider: 'rest' })
      ).rejects.toThrow('Not authenticated');
    });

    it('internal create without user no longer throws a TypeError from scopeByUser', async () => {
      await expect(app.service('sessions').create(sessionData(), {})).rejects.not.toThrow(
        /Cannot read properties of undefined \(reading 'id'\)/
      );
    });

    it('create_new_branch=false uses the selected branch and links an open PR when present', async () => {
      getOpenPR.mockResolvedValueOnce({
        number: 42,
        html_url: 'https://github.com/test/repo/pull/42',
        title: 'Feature PR',
        base_ref: 'develop',
        draft: false,
      });

      const session = await app.service('sessions').create(
        sessionData({
          repo_id: repoId,
          base_branch: 'feature/foo',
          create_new_branch: false,
        }),
        params({ id: userId1 })
      );

      expect(createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'test/repo' }),
        'feature/foo',
        expect.any(String),
        null,
        { detach: false, baseBranch: 'develop' }
      );
      expect(session.created_branch).toBe('feature/foo');
      expect(session.remote_branch).toBe('feature/foo');
      expect(session.base_branch).toBe('develop');
      expect(session.pr_number).toBe(42);
      expect(session.pr_url).toBe('https://github.com/test/repo/pull/42');
      expect(session.label).toBe('Feature PR');
      expect(generateSessionMetadata).not.toHaveBeenCalled();
    });

    it('create_new_branch=false uses default_branch as diff base when no open PR', async () => {
      getOpenPR.mockResolvedValueOnce(null);
      await db('repos').where({ id: repoId }).update({ default_branch: 'mainline' });

      const session = await app.service('sessions').create(
        sessionData({
          repo_id: repoId,
          base_branch: 'feature/bar',
          create_new_branch: false,
        }),
        params({ id: userId1 })
      );

      expect(session.base_branch).toBe('mainline');
      expect(session.pr_number).toBeNull();
      expect(session.created_branch).toBe('feature/bar');
      expect(session.label).toBe('Continuing: feature/bar');
      expect(generateSessionMetadata).not.toHaveBeenCalled();
      expect(createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'test/repo' }),
        'feature/bar',
        expect.any(String),
        null,
        { detach: false, baseBranch: 'mainline' }
      );
    });

    it('persists a system prompt message before the first user message', async () => {
      const createMessage = vi.fn().mockResolvedValue({ id: 99 });
      app.use('messages', { create: createMessage });

      await app
        .service('sessions')
        .create(
          sessionData({ repo_id: repoId, initial_prompt: 'Fix the bug' }),
          params({ id: userId1 })
        );

      expect(buildSystemPromptAppend).toHaveBeenCalledTimes(1);
      const promptCall = createMessage.mock.calls.find(
        ([data]) => data.type === 'system' && data.subtype === 'prompt'
      );
      expect(promptCall).toBeTruthy();
      const parsed = JSON.parse(promptCall[0].message_json);
      expect(parsed.content).toBe('mocked builder system prompt');

      const promptIdx = createMessage.mock.calls.indexOf(promptCall);
      const userMsgIdx = createMessage.mock.calls.findIndex(([data]) => data.type === 'user');
      expect(promptIdx).toBeLessThan(userMsgIdx);
    });

    it('create_new_branch=false rejects when another unarchived session uses that branch', async () => {
      await db('sessions').where({ id: sessId1 }).update({
        created_branch: 'feature/taken',
        remote_branch: 'feature/taken',
        worktree_path: '/tmp/wt-taken',
      });

      await expect(
        app.service('sessions').create(
          sessionData({
            repo_id: repoId,
            base_branch: 'feature/taken',
            create_new_branch: false,
          }),
          params({ id: userId1 })
        )
      ).rejects.toThrow(/already using branch/);

      expect(createWorktree).not.toHaveBeenCalled();
    });

    it('create_new_branch=false rejects when a failed session still has a worktree', async () => {
      await db('sessions').where({ id: sessId1 }).update({
        created_branch: 'feature/taken',
        remote_branch: 'feature/taken',
        status: 'failed',
        worktree_path: '/tmp/wt-taken',
      });

      await expect(
        app.service('sessions').create(
          sessionData({
            repo_id: repoId,
            base_branch: 'feature/taken',
            create_new_branch: false,
          }),
          params({ id: userId1 })
        )
      ).rejects.toThrow(/already using branch/);
    });

    it('create_new_branch=false rejects while another session is still provisioning that branch', async () => {
      await db('sessions').where({ id: sessId1 }).update({
        created_branch: 'feature/taken',
        remote_branch: 'feature/taken',
        status: 'provisioning',
        worktree_path: null,
      });

      await expect(
        app.service('sessions').create(
          sessionData({
            repo_id: repoId,
            base_branch: 'feature/taken',
            create_new_branch: false,
          }),
          params({ id: userId1 })
        )
      ).rejects.toThrow(/already using branch/);
    });

    it('create_new_branch=false allows retrying a branch after a failed setup', async () => {
      createWorktree.mockRejectedValueOnce(new Error('disk full'));

      await expect(
        app.service('sessions').create(
          sessionData({
            repo_id: repoId,
            base_branch: 'feature/retry',
            create_new_branch: false,
          }),
          params({ id: userId1 })
        )
      ).rejects.toThrow(/disk full/);

      const failed = await db('sessions').where({ created_branch: 'feature/retry' }).first();
      expect(failed.status).toBe('failed');
      expect(failed.worktree_path).toBeFalsy();
      expect(removeWorktree).toHaveBeenCalled();

      const session = await app.service('sessions').create(
        sessionData({
          repo_id: repoId,
          base_branch: 'feature/retry',
          create_new_branch: false,
        }),
        params({ id: userId1 })
      );
      expect(session.created_branch).toBe('feature/retry');
      expect(session.status).not.toBe('failed');
    });

    it('returns the session before the worktree exists when syncProvision is false', async () => {
      let resolveWorktree;
      const worktreeReady = new Promise((resolve) => {
        resolveWorktree = () => resolve({ worktreePath: '/tmp/test-worktree' });
      });
      createWorktree.mockImplementationOnce(() => worktreeReady);

      try {
        const session = await app
          .service('sessions')
          .create(sessionData({ repo_id: repoId, initial_prompt: '' }), {
            ...params({ id: userId1 }),
            syncProvision: false,
          });

        expect(session.status).toBe('provisioning');
        expect(session.worktree_path).toBeFalsy();

        resolveWorktree();
        await app.service('sessions')._awaitProvisioning(session.id);

        const row = await db('sessions').where({ id: session.id }).first();
        expect(row.worktree_path).toBeTruthy();
        expect(row.status).toBe('stopped');
      } finally {
        resolveWorktree?.();
      }
    });

    it('rejects archive while a session is still provisioning', async () => {
      let resolveWorktree;
      const worktreeReady = new Promise((resolve) => {
        resolveWorktree = () => resolve({ worktreePath: '/tmp/test-worktree' });
      });
      createWorktree.mockImplementationOnce(() => worktreeReady);

      let session;
      try {
        session = await app.service('sessions').create(sessionData({ repo_id: repoId }), {
          ...params({ id: userId1 }),
          syncProvision: false,
        });

        await expect(
          app.service('sessions').remove(session.id, params({ id: userId1 }))
        ).rejects.toThrow(/still being set up/);

        const row = await db('sessions').where({ id: session.id }).first();
        expect(row.archived_at).toBeFalsy();
        expect(row.status).toBe('provisioning');
        expect(removeWorktree).not.toHaveBeenCalled();
      } finally {
        resolveWorktree?.();
        if (session) await app.service('sessions')._awaitProvisioning(session.id);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. restartInterruptedSessions — recovery of sessions cut short by a reboot
// ─────────────────────────────────────────────────────────────────────────────

describe('Sessions service - restartInterruptedSessions', (hooks) => {
  const db = createTestDb(hooks);

  let app;
  let userId;
  let repoId;

  const seedSession = (overrides = {}) =>
    db('sessions')
      .insert({
        user_id: userId,
        repo_id: repoId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'Interrupted task',
        short_id: Math.random().toString(16).slice(2, 10),
        status: 'running',
        ...overrides,
      })
      .then(([id]) => id);

  const messagesFor = (sessionId) =>
    db('session_messages').where({ session_id: sessionId }).orderBy('id', 'asc');

  const statusTextsFor = async (sessionId) =>
    (await messagesFor(sessionId))
      .filter((m) => m.type === 'system' && m.subtype === 'status')
      .map((m) => JSON.parse(m.message_json).status);

  // messages.create notifies the agent about every message it persists; the real agent services
  // ignore anything that is not a user message, so assert on those only.
  const userDispatches = (mock) => mock.mock.calls.filter(([message]) => message.type === 'user');

  beforeEach(async () => {
    vi.clearAllMocks();
    onMessageCreated.mockResolvedValue(undefined);
    cursorOnMessageCreated.mockResolvedValue(undefined);
    loadBaguetteConfig.mockResolvedValue(null);

    await db('users').insert({ github_id: 2001, username: 'alice', approved: true });
    userId = (await db('users').where({ username: 'alice' }).first()).id;
    await db('repos').insert({ full_name: 'test/repo', bare_path: '/tmp/repo' });
    repoId = (await db('repos').where({ full_name: 'test/repo' }).first()).id;

    app = makeApp(db);
    await app.setup();
  });

  it('resumes a running Claude session that has a stored transcript', async () => {
    const sessId = await seedSession({ claude_session_id: 'claude-abc' });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 1, stopped: 0, failed: 0 });
    expect(await statusTextsFor(sessId)).toEqual(['Server restarted — resuming session']);

    // The nudge reaches the agent as a collapsible Baguette message, not as a user message.
    const dispatched = userDispatches(onMessageCreated);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0][0].session_id).toBe(sessId);
    const parsed = JSON.parse(dispatched[0][0].message_json);
    expect(parsed.source).toBe('baguette');
    expect(parsed.message.content).toMatch(/interrupted your previous turn/);
  });

  it('routes a Cursor session to the cursor agent', async () => {
    const sessId = await seedSession({ agent_sdk: 'cursor', cursor_agent_id: 'cur-1' });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 1, stopped: 0, failed: 0 });
    const dispatched = userDispatches(cursorOnMessageCreated);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0][0].session_id).toBe(sessId);
    expect(userDispatches(onMessageCreated)).toHaveLength(0);
  });

  it('stops a session with no transcript to resume from and offers a Continue button', async () => {
    const sessId = await seedSession({ claude_session_id: null });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 0, stopped: 1, failed: 0 });
    expect((await db('sessions').where({ id: sessId }).first()).status).toBe('stopped');
    expect(userDispatches(onMessageCreated)).toHaveLength(0);

    const [status] = await messagesFor(sessId);
    const parsed = JSON.parse(status.message_json);
    expect(parsed.status).toBe('Server restarted — session was stopped');
    expect(parsed.can_continue).toBe(true);
  });

  it('marks a Cursor session with no stored agent as stopped', async () => {
    await seedSession({ agent_sdk: 'cursor', cursor_agent_id: null, claude_session_id: 'ignored' });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 0, stopped: 1, failed: 0 });
    expect(userDispatches(cursorOnMessageCreated)).toHaveLength(0);
  });

  it('falls back to stopped when the agent fails to resume', async () => {
    const sessId = await seedSession({ claude_session_id: 'claude-abc' });
    onMessageCreated.mockImplementation(async (message) => {
      if (message.type === 'user') throw new Error('worktree is gone');
    });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 0, stopped: 1, failed: 0 });
    expect((await db('sessions').where({ id: sessId }).first()).status).toBe('stopped');
    expect(await statusTextsFor(sessId)).toEqual([
      'Server restarted — resuming session',
      'Server restarted — could not resume session (worktree is gone)',
    ]);
  });

  it('recovers sessions waiting on approval', async () => {
    await seedSession({ status: 'approval', claude_session_id: 'claude-abc' });

    expect(await app.service('sessions').restartInterruptedSessions()).toEqual({
      restarted: 1,
      stopped: 0,
      failed: 0,
    });
  });

  it('leaves settled and archived sessions alone', async () => {
    await seedSession({ status: 'completed', claude_session_id: 'claude-done' });
    await seedSession({ status: 'stopped', claude_session_id: 'claude-stopped' });
    await seedSession({
      status: 'running',
      claude_session_id: 'claude-archived',
      archived_at: new Date().toISOString(),
    });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 0, stopped: 0, failed: 0 });
    expect(onMessageCreated).not.toHaveBeenCalled();
    expect(await db('session_messages')).toHaveLength(0);
  });

  it('marks sessions still provisioning as failed and wipes any partial worktree', async () => {
    const sessId = await seedSession({ status: 'provisioning', worktree_path: null });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 0, stopped: 1, failed: 0 });
    expect((await db('sessions').where({ id: sessId }).first()).status).toBe('failed');
    expect(removeWorktree).toHaveBeenCalled();
  });

  it('finishes sessions left in archiving and sets archived_at', async () => {
    const sessId = await seedSession({ status: 'archiving', worktree_path: '/tmp/wt' });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 0, stopped: 1, failed: 0 });
    const row = await db('sessions').where({ id: sessId }).first();
    expect(row.archived_at).toBeTruthy();
    expect(removeWorktree).toHaveBeenCalled();
  });

  it('keeps going when one session cannot be recovered at all', async () => {
    const failing = await seedSession({ claude_session_id: 'claude-1' });
    const healthy = await seedSession({ claude_session_id: 'claude-2' });
    // Rejecting the status message too means even the stopped fallback cannot be written.
    onMessageCreated.mockImplementation(async (message) => {
      if (message.session_id === failing) throw new Error('boom');
    });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 1, stopped: 0, failed: 1 });
    expect((await db('sessions').where({ id: healthy }).first()).status).toBe('running');
  });
});
