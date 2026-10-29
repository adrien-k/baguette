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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { feathers } from '@feathersjs/feathers';
import { BadRequest, NotFound } from '@feathersjs/errors';
import { createTestDb, insertTestSession, testSessionAgentDefaults } from '../../test-utils/db.js';
import {
  generateSessionShortId,
  registerSessionsService,
  resolveSessionFromData,
} from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { slackFilesDir, slackSessionFilesDir } from '../slack-files.js';
import { insertSlackApp } from './slack-test-helpers.js';
import * as sessionGitStatus from '../session-git-status.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerReposService } from '../feathers/repos.service.js';
import { mountAgentConfigs } from '../../test-utils/agent-sdks.js';
import { registerAgentSdk } from '../feathers/agent-configs.service.js';
import {
  BAGUETTE_DESCRIPTION_MARKER,
  BAGUETTE_FOOTER_MARKER,
  createWorktree,
  getOpenPR,
  getPRStatus,
  mergePR,
  markPRDraft,
  markPRReady,
  closePR,
  removeWorktree,
} from '../github.js';

// ── Module-level mocks ────────────────────────────────────────────────────────

const {
  stopSession,
  syncSessionSettingsFromPatch,
  loadBaguetteConfig,
  readBaguetteConfigRaw,
  generateSessionMetadata,
  buildSystemPromptAppend,
  reviewStop,
  resumeInterruptedReviews,
} = vi.hoisted(() => ({
  stopSession: vi.fn().mockResolvedValue(undefined),
  syncSessionSettingsFromPatch: vi.fn(),
  loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  readBaguetteConfigRaw: vi.fn().mockResolvedValue({ missing: true }),
  generateSessionMetadata: vi
    .fn()
    .mockResolvedValue({ label: 'Test task', branchName: 'test-task-abc' }),
  buildSystemPromptAppend: vi.fn().mockResolvedValue('mocked builder system prompt'),
  reviewStop: vi.fn().mockResolvedValue({ ok: true }),
  resumeInterruptedReviews: vi.fn().mockResolvedValue({ resumed: 0, failed: 0 }),
}));

vi.mock('../review-agent-turn.js', () => ({
  getReviewAgentTurn: () => ({
    stopReviewerAgent: reviewStop,
    resumeInterrupted: resumeInterruptedReviews,
    peekTurnExtras: () => null,
    setTurnExtras: vi.fn(),
  }),
  registerReviewAgentTurn: vi.fn(),
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
    mergePR: vi.fn().mockResolvedValue(undefined),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    markPRDraft: vi.fn().mockResolvedValue(undefined),
    closePR: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig,
    readBaguetteConfigRaw,
  };
});

vi.mock('../session-prompt.js', () => ({
  buildSystemPromptAppend,
}));

// ── Shared helpers ────────────────────────────────────────────────────────────

const params = (user) => ({ provider: 'rest', user });

const claudeHandleMessageCreated = vi.fn().mockResolvedValue(undefined);
const cursorHandleMessageCreated = vi.fn().mockResolvedValue(undefined);
const deleteSessionTasks = vi.fn();
const usersServiceGet = vi.fn().mockResolvedValue({ id: 1, access_token: 'test-token' });
// Not Feathers methods (like the real service): called directly by sessions.service.
const findRunningTask = vi.fn().mockReturnValue(null);
const tasksCreate = vi.fn(async (data) => ({ id: 42, ...data }));
const getTask = vi.fn().mockReturnValue(null);

function claudeInterruptedResumable(_session, { agent } = {}) {
  return Boolean(agent?.claude_session_id);
}

function cursorInterruptedResumable(_session, { agent } = {}) {
  return Boolean(agent?.cursor_agent_id);
}

function makeApp(db) {
  const app = feathers();
  app.set('db', db);
  app.use(
    'tasks',
    {
      deleteSessionTasks,
      create: tasksCreate,
      find: async (params) => {
        const sessionId = params.query?.session_id != null ? Number(params.query.session_id) : null;
        const status = params.query?.status;
        return [].filter((t) => {
          if (sessionId != null && t.session_id !== sessionId) return false;
          if (status != null && t.status !== status) return false;
          return true;
        });
      },
      _findRunningTask: findRunningTask,
      getTask,
    },
    { methods: ['deleteSessionTasks', 'create', 'find'] }
  );
  mountAgentConfigs(app);
  app.use(
    'claude-agent',
    {
      stopSession,
      handleMessageCreated: claudeHandleMessageCreated,
      syncSessionSettingsFromPatch,
      generateSessionMetadata,
      isInterruptedSessionResumable: claudeInterruptedResumable,
    },
    {
      methods: [
        'stopSession',
        'handleMessageCreated',
        'syncSessionSettingsFromPatch',
        'generateSessionMetadata',
        'isInterruptedSessionResumable',
      ],
    }
  );
  app.use(
    'cursor-agent',
    {
      stopSession,
      generateSessionMetadata,
      handleMessageCreated: cursorHandleMessageCreated,
      isInterruptedSessionResumable: cursorInterruptedResumable,
    },
    {
      methods: [
        'stopSession',
        'generateSessionMetadata',
        'handleMessageCreated',
        'isInterruptedSessionResumable',
      ],
    }
  );
  registerAgentSdk(app, { key: 'claude', label: 'Claude', servicePath: 'claude-agent' });
  registerAgentSdk(app, { key: 'cursor', label: 'Cursor', servicePath: 'cursor-agent' });
  app.use('users', { get: usersServiceGet }, { methods: ['get'] });
  registerSessionsService(app);
  registerAgentsService(app);
  registerMessagesService(app);
  return app;
}

async function seedUserAndSession(db, { github_id, username, shortId, sessionPath = null } = {}) {
  await db('users').insert({ github_id, username, approved: true });
  const user = await db('users').where({ username }).first();

  await db('repos')
    .insert({ full_name: 'test/repo', repo_path: '/tmp/repo' })
    .onConflict('full_name')
    .ignore();
  const repo = await db('repos').where({ full_name: 'test/repo' }).first();

  const sessId = await insertTestSession(db, {
    user_id: user.id,
    repo_id: repo.id,
    repo_full_name: 'test/repo',
    base_branch: 'main',
    initial_prompt: `Task for ${username}`,
    short_id: shortId,
    status: 'active',
    session_path: sessionPath,
    ...testSessionAgentDefaults,
  });

  return { user, repo, sessId };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Custom methods: stop, commands, remove
// ─────────────────────────────────────────────────────────────────────────────

describe('Sessions service - custom methods', () => {
  const db = createTestDb();

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
      sessionPath: '/tmp/wt',
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
      const builder = await db('agents').where({ session_id: sessId, is_primary: 1 }).first();
      await db('agents').where({ id: builder.id }).update({ status: 'running', active_turn_id: 3 });

      const result = await app.service('sessions').stop(sessId, params({ id: userId }));

      expect(stopSession).toHaveBeenCalledWith(sessId, expect.anything());
      expect(result).toEqual({ ok: true });
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.status).toBe('stopped');
      const agentAfter = await db('agents').where({ id: builder.id }).first();
      expect(agentAfter.status).toBe('stopped');
      expect(agentAfter.active_turn_id).toBeNull();
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

  // ── archiveAfterTurn (the agent closing its own session) ───────────────────

  describe('archiveAfterTurn', () => {
    afterEach(() => vi.useRealTimers());

    const sessions = () => app.service('sessions');
    const archivedAt = async () => (await db('sessions').where({ id: sessId }).first()).archived_at;

    it('archives the session a couple of seconds after the turn that asked for it', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      sessions().archiveAfterTurn(sessId);
      await sessions()._archiveIfRequestedAfterTurn(sessId, { is_primary: 1 });

      expect(await archivedAt()).toBeFalsy();
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(async () => expect(await archivedAt()).toBeTruthy());
    });

    it('does nothing for a session nobody asked to archive', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      await sessions()._archiveIfRequestedAfterTurn(sessId, { is_primary: 1 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await archivedAt()).toBeFalsy();
    });

    it('waits for the main agent: a subagent finishing its turn does not close the session', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      sessions().archiveAfterTurn(sessId);
      await sessions()._archiveIfRequestedAfterTurn(sessId, { is_primary: 0 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await archivedAt()).toBeFalsy();

      await sessions()._archiveIfRequestedAfterTurn(sessId, { is_primary: 1 });
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(async () => expect(await archivedAt()).toBeTruthy());
    });

    it('only archives once, however many turns finish afterwards', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      const archive = vi.spyOn(sessions(), 'archive').mockResolvedValue({});
      sessions().archiveAfterTurn(sessId);
      await sessions()._archiveIfRequestedAfterTurn(sessId, { is_primary: 1 });
      await sessions()._archiveIfRequestedAfterTurn(sessId, { is_primary: 1 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(archive).toHaveBeenCalledTimes(1);
      expect(archive).toHaveBeenCalledWith({ id: sessId }, { provider: undefined });
      archive.mockRestore();
    });

    it('keeps running if archiving fails', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      const archive = vi
        .spyOn(sessions(), 'archive')
        .mockRejectedValue(new Error('cleanup failed'));
      sessions().archiveAfterTurn(sessId);
      await sessions()._archiveIfRequestedAfterTurn(sessId, { is_primary: 1 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(archive).toHaveBeenCalledTimes(1);
      archive.mockRestore();
    });
  });

  // ── createDefaultBuilderMessage ────────────────────────────────────────────

  describe('createDefaultBuilderMessage', () => {
    it('creates a user message with primary builder identity', async () => {
      const builder = await db('agents').where({ session_id: sessId, is_primary: 1 }).first();
      await db('agents').where({ id: builder.id }).update({ model: 'test-model' });

      const result = await app
        .service('sessions')
        .createDefaultBuilderMessage(
          { id: sessId, content: 'Proceed with the plan.' },
          params({ id: userId })
        );

      expect(result.type).toBe('user');
      expect(result.agent_id).toBe(builder.id);
      expect(result.model).toBe('test-model');
      const parsed = JSON.parse(result.message_json);
      const text = parsed.content ?? parsed.message?.content;
      expect(text).toBe('Proceed with the plan.');
    });

    it('rejects empty content', async () => {
      await expect(
        app
          .service('sessions')
          .createDefaultBuilderMessage({ id: sessId, content: '   ' }, params({ id: userId }))
      ).rejects.toThrow(BadRequest);
    });

    it('creates ask_user_answer with structured answers', async () => {
      const builder = await db('agents').where({ session_id: sessId, is_primary: 1 }).first();
      const answers = [{ question: 'Pick one', value: 'A' }];

      const result = await app.service('sessions').createDefaultBuilderMessage(
        {
          id: sessId,
          content: '**Pick one**: A',
          subtype: 'ask_user_answer',
          answers,
        },
        params({ id: userId })
      );

      expect(result.type).toBe('user');
      expect(result.subtype).toBe('ask_user_answer');
      expect(result.agent_id).toBe(builder.id);
      const parsed = JSON.parse(result.message_json);
      expect(parsed.subtype).toBe('ask_user_answer');
      expect(parsed.content).toBe('**Pick one**: A');
      expect(parsed.answers).toEqual(answers);
    });

    it('rejects malformed ask_user_answer rows', async () => {
      await expect(
        app.service('sessions').createDefaultBuilderMessage(
          {
            id: sessId,
            content: '**Q**: A',
            subtype: 'ask_user_answer',
            answers: [{}],
          },
          params({ id: userId })
        )
      ).rejects.toThrow();
    });
  });

  // ── merge ──────────────────────────────────────────────────────────────────

  describe('merge', () => {
    beforeEach(async () => {
      await db('sessions')
        .where({ id: sessId })
        .update({ pr_number: 42, pr_status: 'open', repo_full_name: 'test/repo' });
      mergePR.mockResolvedValue(undefined);
    });

    it('merges PR, updates pr_status, and archives when archive is true', async () => {
      const result = await app
        .service('sessions')
        .merge({ id: sessId, archive: true }, params({ id: userId }));

      expect(mergePR).toHaveBeenCalledWith('test-token', 'test/repo', 42);
      expect(result).toEqual({ ok: true, merged: true, archived: true });
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.pr_status).toBe('merged');
      await vi.waitFor(async () => {
        const archived = await db('sessions').where({ id: sessId }).first();
        expect(archived.archived_at).not.toBeNull();
      });
    });

    it('returns merge success when archive is requested even if archive fails', async () => {
      const sessionsSvc = app.service('sessions');
      vi.spyOn(sessionsSvc, 'archive').mockRejectedValueOnce(
        new BadRequest('Session is archiving')
      );

      const result = await sessionsSvc.merge({ id: sessId, archive: true }, params({ id: userId }));
      expect(result).toEqual({ ok: true, merged: true, archived: true });

      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.pr_status).toBe('merged');
    });
  });

  // ── setPrDraft ─────────────────────────────────────────────────────────────

  describe('setPrDraft', () => {
    beforeEach(async () => {
      await db('sessions')
        .where({ id: sessId })
        .update({ pr_number: 42, pr_status: 'open', repo_full_name: 'test/repo' });
      markPRReady.mockClear();
      markPRDraft.mockClear();
    });

    it('marks an open PR as draft', async () => {
      const result = await app
        .service('sessions')
        .setPrDraft({ id: sessId, draft: true }, params({ id: userId }));

      expect(markPRDraft).toHaveBeenCalledWith('test-token', 'test/repo', 42);
      expect(markPRReady).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, pr_status: 'draft' });
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.pr_status).toBe('draft');
    });

    it('marks a draft PR ready for review', async () => {
      await db('sessions').where({ id: sessId }).update({ pr_status: 'draft' });

      const result = await app
        .service('sessions')
        .setPrDraft({ id: sessId, draft: false }, params({ id: userId }));

      expect(markPRReady).toHaveBeenCalledWith('test-token', 'test/repo', 42);
      expect(markPRDraft).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, pr_status: 'open' });
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.pr_status).toBe('open');
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

    it('returns empty commands when session has no session_path', async () => {
      const sessId2 = await insertTestSession(db, {
        user_id: userId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'no wt',
        short_id: 'nowt11',
        status: 'active',
        session_path: null,
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

  describe('baguetteYaml', () => {
    it('returns missing when config file is absent', async () => {
      readBaguetteConfigRaw.mockResolvedValue({ missing: true });

      const result = await app.service('sessions').baguetteYaml(sessId, params({ id: userId }));

      expect(readBaguetteConfigRaw).toHaveBeenCalledWith('/tmp/wt');
      expect(result).toEqual({ yaml: null, missing: true });
    });

    it('returns raw yaml from worktree', async () => {
      readBaguetteConfigRaw.mockResolvedValue({ yaml: 'session:\n  init: npm ci\n' });

      const result = await app.service('sessions').baguetteYaml(sessId, params({ id: userId }));

      expect(result).toEqual({ yaml: 'session:\n  init: npm ci\n', missing: false });
    });

    it('returns missing when session has no session_path', async () => {
      const sessId2 = await insertTestSession(db, {
        user_id: userId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'no wt',
        short_id: 'nowt12',
        status: 'active',
        session_path: null,
      });

      const result = await app.service('sessions').baguetteYaml(sessId2, params({ id: userId }));

      expect(readBaguetteConfigRaw).not.toHaveBeenCalled();
      expect(result).toEqual({ yaml: null, missing: true });
    });
  });

  // ── startPreviewService ────────────────────────────────────────────────────

  describe('startPreviewService', () => {
    beforeEach(() => {
      loadBaguetteConfig.mockResolvedValue({
        services: { app: { task: 'dev', expose: 'PORT' } },
        session: { tasks: { dev: { run: 'npm start', ports: ['PORT'] } } },
      });
      findRunningTask.mockReturnValue(null);
      tasksCreate.mockClear();
    });

    it('starts the sole preview service when service name is omitted', async () => {
      const result = await app
        .service('sessions')
        .startPreviewService({ id: sessId }, params({ id: userId }));

      expect(tasksCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: sessId,
          task_key: 'dev',
        }),
        expect.anything()
      );
      expect(result.id).toBe(42);
    });

    it('does not set ttl_ms (preview tab is a manual start, not proxy idle shutdown)', async () => {
      await app.service('sessions').startPreviewService({ id: sessId }, params({ id: userId }));

      const [createData] = tasksCreate.mock.calls[0];
      expect(createData).not.toHaveProperty('ttl_ms');
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
      ).rejects.toThrow('No preview services are configured for this session');
    });

    it('rejects with NotFound when session belongs to another user', async () => {
      await expect(
        app.service('sessions').startPreviewService({ id: sessId }, params({ id: otherUserId }))
      ).rejects.toBeInstanceOf(NotFound);
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('archive', () => {
    it('closes a draft PR on GitHub when close_pr is set', async () => {
      await db('sessions').where({ id: sessId }).update({
        pr_number: 42,
        pr_status: 'draft',
        pr_url: 'https://github.com/test/repo/pull/42',
      });
      closePR.mockClear();

      await app.service('sessions').archive(sessId, {
        ...params({ id: userId }),
        query: { close_pr: true },
      });

      expect(closePR).toHaveBeenCalledWith('test-token', 'test/repo', 42);
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.pr_status).toBe('closed');
      expect(row.archived_at).toBeTruthy();
    });

    it('rejects close_pr when the session PR is not a draft', async () => {
      await db('sessions').where({ id: sessId }).update({
        pr_number: 42,
        pr_status: 'open',
        pr_url: 'https://github.com/test/repo/pull/42',
      });

      await expect(
        app.service('sessions').archive(sessId, {
          ...params({ id: userId }),
          query: { close_pr: true },
        })
      ).rejects.toThrow(/draft pull requests/);

      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.archived_at).toBeFalsy();
      expect(closePR).not.toHaveBeenCalled();
    });

    describe('Slack files', () => {
      const makeFile = async (dir) => {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'a.png'), 'x');
      };
      const exists = (dir) =>
        fs.access(dir).then(
          () => true,
          () => false
        );
      const linkThread = async (sessionId, slackAppId, thread = '111.222') =>
        db('slack_threads').insert({
          slack_app_id: slackAppId,
          channel_id: 'C1',
          thread_ts: thread,
          session_id: sessionId,
          user_id: userId,
        });

      it('deletes the files downloaded for the session', async () => {
        const slackAppId = await insertSlackApp(db);
        await linkThread(sessId, slackAppId);
        const threadDir = slackFilesDir(slackAppId, 'C1', '111.222');
        const toolDir = slackSessionFilesDir(sessId);
        await makeFile(threadDir);
        await makeFile(toolDir);

        await app.service('sessions').archive(sessId, params({ id: userId }));

        expect(await exists(threadDir)).toBe(false);
        expect(await exists(toolDir)).toBe(false);
      });

      it('keeps the thread files while another live session serves the thread', async () => {
        const slackAppId = await insertSlackApp(db);
        const other = await insertTestSession(db, {
          user_id: userId,
          repo_full_name: 'test/repo',
          base_branch: 'main',
          initial_prompt: 'other',
          short_id: 'other1',
        });
        await linkThread(sessId, slackAppId);
        await linkThread(other, slackAppId);
        const threadDir = slackFilesDir(slackAppId, 'C1', '111.222');
        await makeFile(threadDir);

        await app.service('sessions').archive(sessId, params({ id: userId }));

        expect(await exists(threadDir)).toBe(true);
      });

      it('still archives when the files cannot be deleted', async () => {
        const slackAppId = await insertSlackApp(db);
        await linkThread(sessId, slackAppId);
        const rm = vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('EACCES'));

        const result = await app.service('sessions').archive(sessId, params({ id: userId }));
        rm.mockRestore();

        expect(result.archived_at).toBeTruthy();
      });
    });

    it('stops agent, archives session, returns the session row', async () => {
      const result = await app.service('sessions').archive(sessId, params({ id: userId }));

      expect(stopSession).toHaveBeenCalledWith(sessId, expect.anything());
      expect(reviewStop).not.toHaveBeenCalled();
      expect(deleteSessionTasks).toHaveBeenCalledWith(sessId, expect.anything());
      expect(removeWorktree).toHaveBeenCalled();
      expect(result.id).toBe(sessId);
      expect(result.archived_at).toBeTruthy();
      expect(result.status).toBe('archived');
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.archived_at).toBeTruthy();
      expect(row.status).toBe('archived');
      expect(row.session_path).toBeNull();
    });

    it('trims messages to user and assistant only when archiving', async () => {
      await db('session_messages').insert([
        {
          session_id: sessId,
          type: 'user',
          message_json: JSON.stringify({ type: 'user', content: 'hi' }),
        },
        {
          session_id: sessId,
          type: 'assistant',
          message_json: JSON.stringify({ type: 'assistant', blocks: [] }),
        },
        {
          session_id: sessId,
          type: 'system',
          subtype: 'status',
          message_json: JSON.stringify({ type: 'system', subtype: 'status' }),
        },
        {
          session_id: sessId,
          type: 'tool_call',
          message_json: JSON.stringify({ type: 'tool_call', id: 'x' }),
        },
      ]);

      await app.service('sessions').archive(sessId, params({ id: userId }));

      const types = await db('session_messages')
        .where({ session_id: sessId })
        .orderBy('id', 'asc')
        .pluck('type');
      expect(types).toEqual(['user', 'assistant']);
    });

    it('deletes a strong loop when the session is archived', async () => {
      const repo = await db('repos').first();
      await db('loops').insert({
        user_id: userId,
        repo_id: repo.id,
        repo_full_name: 'test/repo',
        name: 'Regular send',
        base_branch: 'main',
        prompt: 'ping',
        schedule_type: 'interval',
        interval_minutes: 60,
        timezone: 'UTC',
        enabled: true,
        single_session: true,
        created_from_session: true,
        session_id: sessId,
        create_new_branch: false,
        auto_push: false,
      });

      await app.service('sessions').archive(sessId, params({ id: userId }));

      expect(await db('loops').where({ session_id: sessId })).toEqual([]);
    });

    it('keeps a weak loop so the next run can start a new session', async () => {
      const repo = await db('repos').first();
      const [loopId] = await db('loops').insert({
        user_id: userId,
        repo_id: repo.id,
        repo_full_name: 'test/repo',
        name: 'Standalone',
        base_branch: 'main',
        prompt: 'ping',
        schedule_type: 'interval',
        interval_minutes: 60,
        timezone: 'UTC',
        enabled: true,
        single_session: true,
        created_from_session: false,
        session_id: sessId,
        create_new_branch: false,
        auto_push: false,
      });

      await app.service('sessions').archive(sessId, params({ id: userId }));

      const loops = await db('loops').where({ id: loopId });
      expect(loops).toHaveLength(1);
      expect(loops[0].session_id).toBe(sessId);
    });

    it('sets archived_at only after removeWorktree runs', async () => {
      removeWorktree.mockImplementationOnce(async () => {
        const row = await db('sessions').where({ id: sessId }).first();
        expect(row.archived_at).toBeFalsy();
        expect(row.status).toBe('archiving');
      });

      await app.service('sessions').archive(sessId, params({ id: userId }));
    });

    it('rejects a second archive while one is in progress', async () => {
      let resolveRemove;
      const removing = new Promise((resolve) => {
        resolveRemove = resolve;
      });
      removeWorktree.mockImplementationOnce(() => removing);

      try {
        const first = app.service('sessions').archive(sessId, params({ id: userId }));
        await vi.waitFor(async () => {
          const row = await db('sessions').where({ id: sessId }).first();
          expect(row.status).toBe('archiving');
        });
        await expect(
          app.service('sessions').archive(sessId, params({ id: userId }))
        ).rejects.toThrow(/already being archived/);
        resolveRemove();
        await first;
      } finally {
        resolveRemove?.();
      }
    });

    it('archives when the session is still marked provisioning', async () => {
      await db('sessions').where({ id: sessId }).update({ status: 'provisioning' });

      await app.service('sessions').archive(sessId, params({ id: userId }));

      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.archived_at).toBeTruthy();
      expect(row.status).toBe('archived');
      expect(removeWorktree).toHaveBeenCalled();
    });

    it('removes worktree by short_id when session_path is not set yet', async () => {
      await db('sessions').where({ id: sessId }).update({
        session_path: null,
        short_id: 'deadbeef',
        status: 'stopped',
      });

      await app.service('sessions').archive(sessId, params({ id: userId }));

      expect(removeWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ id: sessId, short_id: 'deadbeef', session_path: null }),
        expect.objectContaining({ full_name: 'test/repo' }),
        { keepLocalBranch: true }
      );
      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.archived_at).toBeTruthy();
    });

    it('rejects with NotFound for an unknown id', async () => {
      await expect(
        app.service('sessions').archive(99999, params({ id: userId }))
      ).rejects.instanceOf(NotFound);
    });

    it('rejects with NotFound when session belongs to another user', async () => {
      await expect(
        app.service('sessions').archive(sessId, params({ id: otherUserId }))
      ).rejects.instanceOf(NotFound);
    });

    it('rejects when not authenticated', async () => {
      await expect(app.service('sessions').archive(sessId, { provider: 'rest' })).rejects.toThrow(
        'Not authenticated'
      );
    });

    it('archives cursor sessions like claude sessions', async () => {
      await db('agents').where({ session_id: sessId, is_primary: 1 }).update({
        agent_sdk: 'cursor',
        cursor_agent_id: 'test-cursor-agent-id',
      });

      await app.service('sessions').archive(sessId, params({ id: userId }));

      const row = await db('sessions').where({ id: sessId }).first();
      expect(row.archived_at).toBeTruthy();
    });
  });

  // ── removeByRepoId ─────────────────────────────────────────────────────────

  describe('removeByRepoId', () => {
    it('stops and soft-deletes all non-deleted sessions for the repo', async () => {
      const repo = await db('repos').where({ full_name: 'test/repo' }).first();

      const sess2 = await insertTestSession(db, {
        user_id: userId,
        repo_id: repo.id,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'second task',
        short_id: 'xyz789',
        status: 'stopped',
        session_path: null,
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
        repo_path: '/tmp/empty',
      });

      await expect(app.service('sessions').removeByRepoId(repoId)).resolves.toBeUndefined();

      expect(stopSession).not.toHaveBeenCalled();
    });

    it('archives all users sessions when no user scope is passed (global repo delete)', async () => {
      const repo = await db('repos').where({ full_name: 'test/repo' }).first();

      const otherSessId = await insertTestSession(db, {
        user_id: otherUserId,
        repo_id: repo.id,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'bob task',
        short_id: 'bob123',
        status: 'stopped',
        session_path: null,
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

      const otherSessId = await insertTestSession(db, {
        user_id: otherUserId,
        repo_id: repo.id,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'bob task',
        short_id: 'bob123',
        status: 'stopped',
        session_path: null,
      });

      await app.service('sessions').removeByRepoId(repo.id, { user: { id: userId } });

      const alice = await db('sessions').where({ id: sessId }).first();
      const bob = await db('sessions').where({ id: otherSessId }).first();
      expect(alice.archived_at).toBeTruthy();
      expect(bob.archived_at).toBeFalsy();
      expect(stopSession).not.toHaveBeenCalledWith(otherSessId, expect.anything());
    });

    it('internal archive can archive another user session when provider is omitted', async () => {
      const otherSessId = await insertTestSession(db, {
        user_id: otherUserId,
        repo_id: (await db('repos').where({ full_name: 'test/repo' }).first()).id,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'bob task',
        short_id: 'bob456',
        status: 'stopped',
        session_path: null,
      });

      await app.service('sessions').archive(otherSessId);

      const row = await db('sessions').where({ id: otherSessId }).first();
      expect(row.archived_at).toBeTruthy();
    });
  });

  describe('remove (permanent delete)', () => {
    it('removes an archived session but keeps usage rows', async () => {
      const builderId = await db('agents')
        .where({ session_id: sessId, is_primary: 1 })
        .first()
        .then((r) => r.id);

      await db('session_messages').insert({
        session_id: sessId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'hi' }),
        agent_id: builderId,
      });

      const [usageId] = await db('usage').insert({
        session_id: sessId,
        user_id: userId,
        repo_full_name: 'test/repo',
        cost_usd: 1.25,
        agent_id: builderId,
      });

      await app.service('sessions').archive(sessId, params({ id: userId }));

      await app.service('sessions').remove(sessId, params({ id: userId }));

      expect(await db('sessions').where({ id: sessId }).first()).toBeUndefined();
      expect(await db('session_messages').where({ session_id: sessId })).toEqual([]);
      expect(await db('agents').where({ session_id: sessId })).toEqual([]);
      const usage = await db('usage').where({ id: usageId }).first();
      expect(usage).toBeTruthy();
      expect(usage.session_id).toBeNull();
      expect(usage.agent_id).toBeNull();
      expect(Number(usage.cost_usd)).toBe(1.25);
    });

    it('rejects when the session is not archived', async () => {
      await expect(app.service('sessions').remove(sessId, params({ id: userId }))).rejects.toThrow(
        /Archive the session/
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Repos unlink — session scope (real sessions + repos services)
// ─────────────────────────────────────────────────────────────────────────────

describe('Repos service - unlink', () => {
  const db = createTestDb();

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

    bobSessId = await insertTestSession(db, {
      user_id: otherUserId,
      repo_id: repoId,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'bob task',
      short_id: 'bob123',
      status: 'stopped',
      session_path: null,
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
    ...testSessionAgentDefaults,
    ...overrides,
  };
}

describe('Sessions service - find, get, create', () => {
  const db = createTestDb();

  let app;
  let repoId;
  let userId1;
  let userId2;
  let sessId1;
  let sessId2;

  beforeEach(async () => {
    vi.clearAllMocks();
    loadBaguetteConfig.mockResolvedValue(null);

    await db('users').insert([
      { github_id: 1001, username: 'alice', approved: true },
      { github_id: 1002, username: 'bob', approved: true },
    ]);
    userId1 = (await db('users').where({ username: 'alice' }).first()).id;
    userId2 = (await db('users').where({ username: 'bob' }).first()).id;

    await db('repos').insert({ full_name: 'test/repo', repo_path: '/tmp/repo' });
    repoId = (await db('repos').where({ full_name: 'test/repo' }).first()).id;

    sessId1 = await insertTestSession(db, {
      user_id: userId1,
      repo_id: repoId,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'Task for Alice',
      short_id: 'a1b2c3',
      status: 'active',
    });
    sessId2 = await insertTestSession(db, {
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
      await insertTestSession(db, {
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

    it('orders non-archived before archived, then by last activity (not pr_status)', async () => {
      const mergedRecentId = await insertTestSession(db, {
        user_id: userId1,
        repo_id: repoId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'Merged PR',
        short_id: 'mrg111',
        status: 'completed',
        pr_status: 'merged',
        last_activity_at: '2026-03-01T00:00:00.000Z',
      });
      const staleActiveId = await insertTestSession(db, {
        user_id: userId1,
        repo_id: repoId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'Older active',
        short_id: 'old222',
        status: 'completed',
        pr_status: 'open',
        last_activity_at: '2026-01-01T00:00:00.000Z',
      });
      await db('sessions').where({ id: sessId1 }).update({
        last_activity_at: '2026-02-01T00:00:00.000Z',
      });
      const archivedId = await insertTestSession(db, {
        user_id: userId1,
        repo_id: repoId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'Archived',
        short_id: 'arc333',
        status: 'completed',
        archived_at: '2026-04-01T00:00:00.000Z',
        last_activity_at: '2026-05-01T00:00:00.000Z',
      });

      const result = await app.service('sessions').find({ query: {}, ...params({ id: userId1 }) });
      const ids = (result.data ?? result).map((s) => s.id);

      expect(ids.indexOf(archivedId)).toBeGreaterThan(ids.indexOf(mergedRecentId));
      expect(ids.indexOf(archivedId)).toBeGreaterThan(ids.indexOf(staleActiveId));
      expect(ids.slice(0, 3)).toEqual([mergedRecentId, sessId1, staleActiveId]);
      expect(ids[ids.length - 1]).toBe(archivedId);
    });

    it('excludes archived sessions when include_archived is false', async () => {
      await db('sessions').where({ id: sessId1 }).update({
        archived_at: '2026-04-01T00:00:00.000Z',
      });
      const openId = await insertTestSession(db, {
        user_id: userId1,
        repo_id: repoId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'Open',
        short_id: 'opn111',
        status: 'completed',
      });

      const hidden = await app.service('sessions').find({
        query: { include_archived: false },
        ...params({ id: userId1 }),
      });
      const shown = await app.service('sessions').find({
        query: { include_archived: true },
        ...params({ id: userId1 }),
      });

      expect((hidden.data ?? hidden).map((s) => s.id)).toEqual([openId]);
      expect((shown.data ?? shown).map((s) => s.id).sort()).toEqual([sessId1, openId].sort());
    });

    it('excludes loop runs when include_loop_runs is false', async () => {
      await db('sessions').where({ id: sessId1 }).update({ loop_id: 7 });
      const plainId = await insertTestSession(db, {
        user_id: userId1,
        repo_id: repoId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'Manual',
        short_id: 'man111',
        status: 'completed',
      });

      const result = await app.service('sessions').find({
        query: { include_loop_runs: false },
        ...params({ id: userId1 }),
      });
      expect((result.data ?? result).map((s) => s.id)).toEqual([plainId]);
    });

    it('hides opted-out repos on all_sessions and keeps the same filter on later pages', async () => {
      const [hiddenRepoId] = await db('repos').insert({
        full_name: 'test/hidden',
        repo_path: '/tmp/hidden',
      });
      await db('user_repos').insert([
        { user_id: userId1, repo_id: repoId, show_in_all_sessions: 1 },
        { user_id: userId1, repo_id: hiddenRepoId, show_in_all_sessions: 0 },
      ]);
      const hiddenSessId = await insertTestSession(db, {
        user_id: userId1,
        repo_id: hiddenRepoId,
        repo_full_name: 'test/hidden',
        base_branch: 'main',
        initial_prompt: 'Hidden repo',
        short_id: 'hid111',
        status: 'completed',
        last_activity_at: '2026-01-01T00:00:00.000Z',
      });
      await db('sessions').where({ id: sessId1 }).update({
        last_activity_at: '2026-03-01T00:00:00.000Z',
      });
      const extraIds = [];
      for (let i = 0; i < 3; i++) {
        const id = await insertTestSession(db, {
          user_id: userId1,
          repo_id: repoId,
          repo_full_name: 'test/repo',
          base_branch: 'main',
          initial_prompt: `Extra ${i}`,
          short_id: `ex${i}111`,
          status: 'completed',
          last_activity_at: `2026-02-0${i + 1}T00:00:00.000Z`,
        });
        extraIds.push(id);
      }

      const pageQuery = { all_sessions: true, include_archived: false, $limit: 2, $skip: 0 };
      const page1 = await app.service('sessions').find({
        query: pageQuery,
        ...params({ id: userId1 }),
      });
      const page2 = await app.service('sessions').find({
        query: { ...pageQuery, $skip: 2 },
        ...params({ id: userId1 }),
      });

      const page1Ids = (page1.data ?? page1).map((s) => s.id);
      const page2Ids = (page2.data ?? page2).map((s) => s.id);
      expect(page1.total).toBe(4);
      expect(page1Ids).toHaveLength(2);
      expect(page1Ids).not.toContain(hiddenSessId);
      expect(page2Ids).not.toContain(hiddenSessId);
      expect([...page1Ids, ...page2Ids].sort()).toEqual([sessId1, ...extraIds].sort());
    });

    it('filters by is_global and repo_id', async () => {
      const globalId = await insertTestSession(db, {
        user_id: userId1,
        repo_id: null,
        repo_full_name: '',
        is_global: 1,
        base_branch: '',
        initial_prompt: 'Global',
        short_id: 'glb111',
        status: 'completed',
      });

      const globalOnly = await app.service('sessions').find({
        query: { is_global: true },
        ...params({ id: userId1 }),
      });
      const repoOnly = await app.service('sessions').find({
        query: { repo_id: repoId },
        ...params({ id: userId1 }),
      });

      expect((globalOnly.data ?? globalOnly).map((s) => s.id)).toEqual([globalId]);
      expect((repoOnly.data ?? repoOnly).map((s) => s.id)).toEqual([sessId1]);
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
      // sessId1 already has session_path=null; give it one for preview tests
      await db('sessions').where({ id: sessId1 }).update({ session_path: '/tmp/wt-preview' });
    });

    it('is set when baguette config has a services block', async () => {
      loadBaguetteConfig.mockResolvedValue({
        services: { api: { task: 'server', expose: 'PORT' } },
        session: { tasks: { server: { run: 'node api.js', ports: ['PORT'] } } },
      });

      const session = await app.service('sessions').get(sessId1, params({ id: userId1 }));

      expect(session.preview_url).toBeTruthy();
      expect(session.preview_url).toContain('session-a1b2c3');
    });

    it('is false when baguette config has no services block', async () => {
      loadBaguetteConfig.mockResolvedValue({ session: { tasks: { test: { run: 'npm test' } } } });

      const session = await app.service('sessions').get(sessId1, params({ id: userId1 }));

      expect(session.preview_url).toBeFalsy();
    });

    it('is false when config is null', async () => {
      loadBaguetteConfig.mockResolvedValue(null);

      const session = await app.service('sessions').get(sessId1, params({ id: userId1 }));

      expect(session.preview_url).toBeFalsy();
    });

    it('is false when session has no session_path', async () => {
      await db('sessions').where({ id: sessId2 }).update({ session_path: null });
      loadBaguetteConfig.mockResolvedValue({ session: { tasks: { test: { run: 'npm test' } } } });

      const session = await app.service('sessions').get(sessId2, params({ id: userId2 }));

      expect(session.preview_url).toBeFalsy();
      expect(loadBaguetteConfig).not.toHaveBeenCalled();
    });
  });

  // ── patch ──────────────────────────────────────────────────────────────────

  describe('patch', () => {
    it('serializes model_params objects before writing to SQLite', async () => {
      await app.service('sessions').patch(
        sessId1,
        {
          model: 'composer-2.5',
          model_params: [{ id: 'fast', value: 'false' }],
        },
        params({ id: userId1 })
      );
      const builder = await db('agents').where({ session_id: sessId1, is_primary: 1 }).first();
      expect(builder.model_params).toBe('[{"id":"fast","value":"false"}]');
    });

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

    it('persists review_agent_sdk from client patch', async () => {
      const updated = await app.service('sessions').patch(
        sessId1,
        {
          review_agent_sdk: 'cursor',
          review_model: 'composer',
          review_model_params: null,
        },
        params({ id: userId1 })
      );

      expect(updated.review_agent_sdk).toBe('cursor');
      expect(updated.review_model).toBe('composer');
    });

    it('clears builder agent resume ids when agent_sdk changes', async () => {
      await app.service('sessions').patch(
        sessId1,
        {
          agent_sdk: 'claude',
          claude_session_id: 'claude-thread-1',
          cursor_agent_id: 'cursor-thread-1',
        },
        params({ id: userId1 })
      );

      const updated = await app
        .service('sessions')
        .patch(sessId1, { agent_sdk: 'cursor' }, params({ id: userId1 }));

      expect(updated.agent_sdk).toBe('cursor');
      expect(updated.claude_session_id).toBeNull();
      expect(updated.cursor_agent_id).toBeNull();
    });

    it('clears builder agent resume ids when agent_config_id changes to a different sdk', async () => {
      const { insertTestAgentConfig } = await import('../../test-utils/agent-configs.js');
      const claudeId = await insertTestAgentConfig(db, userId1, {
        sdk: 'claude',
        apiKey: 'sk-ant',
      });
      const cursorId = await insertTestAgentConfig(db, userId1, {
        sdk: 'cursor',
        apiKey: 'cursor-key',
        apiKeyEnvVar: null,
        label: 'Cursor',
      });
      await app.service('sessions').patch(
        sessId1,
        {
          agent_config_id: claudeId,
          claude_session_id: 'claude-thread-1',
          cursor_agent_id: 'cursor-thread-1',
        },
        params({ id: userId1 })
      );

      const updated = await app
        .service('sessions')
        .patch(sessId1, { agent_config_id: cursorId }, params({ id: userId1 }));

      expect(updated.agent_sdk).toBe('cursor');
      expect(updated.claude_session_id).toBeNull();
      expect(updated.cursor_agent_id).toBeNull();
    });

    it('keeps builder agent resume ids when agent_config_id changes to the same sdk', async () => {
      const { insertTestAgentConfig } = await import('../../test-utils/agent-configs.js');
      const claudeA = await insertTestAgentConfig(db, userId1, {
        sdk: 'claude',
        apiKey: 'sk-ant-a',
        label: 'Claude A',
      });
      const claudeB = await insertTestAgentConfig(db, userId1, {
        sdk: 'claude',
        apiKey: 'sk-ant-b',
        label: 'Claude B',
      });
      await app.service('sessions').patch(
        sessId1,
        {
          agent_config_id: claudeA,
          claude_session_id: 'claude-thread-1',
        },
        params({ id: userId1 })
      );

      const updated = await app
        .service('sessions')
        .patch(sessId1, { agent_config_id: claudeB }, params({ id: userId1 }));

      expect(updated.agent_sdk).toBe('claude');
      expect(updated.agent_config_id).toBe(claudeB);
      expect(updated.claude_session_id).toBe('claude-thread-1');
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

    it('persists builder agent sdk and model at create', async () => {
      const { insertTestAgentConfig } = await import('../../test-utils/agent-configs.js');
      const cursorConfigId = await insertTestAgentConfig(db, userId1, {
        sdk: 'cursor',
        apiKey: 'cursor-test-key',
      });
      const session = await app.service('sessions').create(
        sessionData({
          repo_id: repoId,
          agent_config_id: cursorConfigId,
          agent_sdk: 'cursor',
          model: 'composer-2',
          model_params: '[{"id":"fast","value":"true"}]',
        }),
        params({ id: userId1 })
      );

      expect(session.agent_sdk).toBe('cursor');
      expect(session.model).toBe('composer-2');
      expect(session.model_params).toBe('[{"id":"fast","value":"true"}]');
    });

    it('does not create a reviewer agent from account defaults on session create', async () => {
      const { insertTestAgentConfig } = await import('../../test-utils/agent-configs.js');
      const cursorConfigId = await insertTestAgentConfig(db, userId1, {
        sdk: 'cursor',
        apiKey: 'cursor-test-key',
      });
      await db('users')
        .where({ id: userId1 })
        .update({
          reviewer_default_config_id: cursorConfigId,
          reviewer_default_model: JSON.stringify({ model: 'space-bunny-free', model_params: null }),
        });

      const session = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));

      const row = await db('sessions').where({ id: session.id }).first();
      expect(row.review_agent_config_id).toBeUndefined();
      expect(session.review_agent_config_id).toBeUndefined();
      const reviewer = await db('agents')
        .where({ session_id: session.id, agent_type: 'reviewer' })
        .first();
      expect(reviewer).toBeUndefined();
      const builder = await db('agents').where({ session_id: session.id, is_primary: 1 }).first();
      expect(builder).toBeTruthy();
    });

    it('generates 6-char lowercase alphanumeric short ids', () => {
      for (let i = 0; i < 30; i += 1) {
        expect(generateSessionShortId()).toMatch(/^[a-z0-9]{6}$/);
      }
    });

    it('auto-generates short_id if not provided', async () => {
      const data = sessionData({ repo_id: repoId });
      delete data.short_id;

      const session = await app.service('sessions').create(data, params({ id: userId1 }));

      // short_id is internal — never returned to clients, but stored for name derivation.
      expect(session.short_id).toBeUndefined();
      const row = await db('sessions').where({ id: session.id }).first();
      expect(row.short_id).toMatch(/^[a-z0-9]{6}$/);
    });

    it('regenerates the short_id when a random candidate is already taken', async () => {
      const takenShortId = 'zz9xk2';
      await insertTestSession(db, {
        user_id: userId1,
        repo_id: repoId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'taken id',
        short_id: takenShortId,
        status: 'stopped',
      });

      const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
      const takenBytes = [...takenShortId].map((c) => alphabet.indexOf(c));
      const realRandomBytes = crypto.randomBytes.bind(crypto);
      let drawn = 0;
      const randomBytesSpy = vi.spyOn(crypto, 'randomBytes').mockImplementation((count) => {
        const buf = realRandomBytes(count);
        // Reproduce the taken id over the first candidate's 5 one-byte draws,
        // then fall through to the real RNG for the retry attempt.
        for (let i = 0; i < count && drawn < takenBytes.length; i += 1) {
          buf[i] = takenBytes[drawn];
          drawn += 1;
        }
        return buf;
      });

      try {
        const session = await app
          .service('sessions')
          .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));
        const row = await db('sessions').where({ id: session.id }).first();
        expect(row.short_id).toMatch(/^[a-z0-9]{6}$/);
        expect(row.short_id).not.toBe(takenShortId);
      } finally {
        randomBytesSpy.mockRestore();
      }
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

    it('emits turn:start when onTurnStart runs', async () => {
      const handler = vi.fn();
      app.service('sessions').on('turn:start', handler);

      const created = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));

      handler.mockClear();

      await app.service('sessions').onTurnStart(created.id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        session_id: created.id,
        user_id: userId1,
      });
    });

    it('resolveSessionFromData keeps preset resolvedSession without calling get', async () => {
      const get = vi.fn();
      const session = { id: 42 };
      const context = {
        data: {},
        params: { user: { id: 1 }, resolvedSession: session },
        service: { get },
      };
      await resolveSessionFromData(context);
      expect(get).not.toHaveBeenCalled();
      expect(context.params.resolvedSession).toBe(session);
    });

    it('emits turn:complete when onTurnComplete runs', async () => {
      const handler = vi.fn();
      app.service('sessions').on('turn:complete', handler);

      const created = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));

      handler.mockClear();

      await db('agents')
        .where({ session_id: created.id, is_primary: 1 })
        .update({ status: 'completed' });
      await app.service('sessions').onTurnComplete(created.id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        session_id: created.id,
        user_id: userId1,
      });
    });

    it('runs auto-push before flushing queued turns and emits turn:complete last', async () => {
      const created = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));

      await db('agents')
        .where({ session_id: created.id, is_primary: 1 })
        .update({ status: 'completed' });

      const sessionsSvc = app.service('sessions');
      const order = [];
      vi.spyOn(sessionsSvc, 'maybeAutoPushAfterTurn').mockImplementation(async () => {
        order.push('auto-push');
      });
      vi.spyOn(sessionsSvc, 'flushNextQueuedTurn').mockImplementation(async () => {
        order.push('flush');
      });

      const turnEvents = [];
      sessionsSvc.on('turn:complete', () => turnEvents.push('turn:complete'));

      await sessionsSvc.onTurnComplete(created.id);

      expect(order).toEqual(['auto-push', 'flush']);
      expect(turnEvents).toEqual(['turn:complete']);
    });

    it('does not auto-push when provisioning finishes before any builder turn', async () => {
      const gitStatusSpy = vi.spyOn(sessionGitStatus, 'computeSessionGitStatus').mockResolvedValue({
        commitsToPush: 2,
        commitsSinceReview: 0,
      });
      const pushSpy = vi.spyOn(app.service('sessions'), 'push');

      await app
        .service('sessions')
        .create(
          sessionData({ repo_id: repoId, initial_prompt: 'Start work' }),
          params({ id: userId1 })
        );

      expect(pushSpy).not.toHaveBeenCalled();
      pushSpy.mockRestore();
      gitStatusSpy.mockRestore();
    });

    it('does not flush queued turns after provision when an initial prompt was sent', async () => {
      const sessionsSvc = app.service('sessions');
      const flushSpy = vi.spyOn(sessionsSvc, 'flushNextQueuedTurn');

      await sessionsSvc.create(
        sessionData({ repo_id: repoId, initial_prompt: 'First turn prompt' }),
        params({ id: userId1 })
      );

      expect(flushSpy).not.toHaveBeenCalled();
      flushSpy.mockRestore();
    });

    it('flushes queued turns for every builder after provision when there is no initial prompt', async () => {
      const sessionsSvc = app.service('sessions');
      const flushSpy = vi.spyOn(sessionsSvc, 'flushNextQueuedTurn');

      const created = await sessionsSvc.create(
        sessionData({ repo_id: repoId, initial_prompt: '' }),
        params({ id: userId1 })
      );

      const builders = await db('agents')
        .where({ session_id: created.id, agent_type: 'builder' })
        .orderBy('id', 'asc');
      expect(flushSpy).toHaveBeenCalledTimes(builders.length);
      for (const builder of builders) {
        expect(flushSpy).toHaveBeenCalledWith(created.id, builder.id);
      }
      flushSpy.mockRestore();
    });

    it('skips auto-push when auto_push is off', async () => {
      const created = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));

      await db('sessions').where({ id: created.id }).update({
        session_path: '/tmp/wt-auto-push-off',
        auto_push: 0,
        status: 'completed',
        label: 'No push',
      });

      vi.spyOn(sessionGitStatus, 'computeSessionGitStatus').mockResolvedValue({
        commitsToPush: 3,
        commitsSinceReview: 0,
      });

      const pushSpy = vi.spyOn(app.service('sessions'), 'push');
      await app.service('sessions').onTurnComplete(created.id);
      expect(pushSpy).not.toHaveBeenCalled();
      pushSpy.mockRestore();
    });

    it('skips auto-push when there are no commits to push', async () => {
      const created = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));

      await db('sessions').where({ id: created.id }).update({
        session_path: '/tmp/wt-auto-push-no-commits',
        auto_push: 1,
        status: 'completed',
        label: 'Title only',
        pr_description: 'Body without new commits',
        pr_number: 42,
      });

      vi.spyOn(sessionGitStatus, 'computeSessionGitStatus').mockResolvedValue({
        commitsToPush: 0,
        commitsSinceReview: 0,
      });

      const pushSpy = vi.spyOn(app.service('sessions'), 'push');
      await app.service('sessions').onTurnComplete(created.id);
      expect(pushSpy).not.toHaveBeenCalled();
      pushSpy.mockRestore();
    });

    it('does not flush queued messages when onTurnComplete runs on an approval session', async () => {
      const created = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));

      const builderAgent = await db('agents')
        .where({ session_id: created.id, is_primary: 1 })
        .first();
      await app
        .get('db')('queued_messages')
        .insert({
          session_id: created.id,
          user_id: userId1,
          kind: 'turn',
          agent_id: builderAgent.id,
          agent_sdk: builderAgent.agent_sdk,
          model: builderAgent.model,
          message_json: JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'queued' },
          }),
          created_at: new Date().toISOString(),
        });

      await db('agents')
        .where({ session_id: created.id, is_primary: 1 })
        .update({ status: 'approval' });

      const flushSpy = vi.spyOn(app.service('sessions'), 'flushNextQueuedTurn');
      const turnHandler = vi.fn();
      app.service('sessions').on('turn:complete', turnHandler);

      await app.service('sessions').onTurnComplete(created.id);

      expect(flushSpy).not.toHaveBeenCalled();
      expect(turnHandler).toHaveBeenCalledTimes(1);
      const remaining = await app
        .get('db')('queued_messages')
        .where({ session_id: created.id, kind: 'turn' });
      expect(remaining).toHaveLength(1);
      flushSpy.mockRestore();
    });

    it('does not flush queued messages when onTurnComplete runs on a stopped session', async () => {
      const created = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));

      const builderAgent = await db('agents')
        .where({ session_id: created.id, is_primary: 1 })
        .first();
      await app
        .get('db')('queued_messages')
        .insert({
          session_id: created.id,
          user_id: userId1,
          kind: 'turn',
          agent_id: builderAgent.id,
          agent_sdk: builderAgent.agent_sdk,
          model: builderAgent.model,
          message_json: JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'queued' },
          }),
          created_at: new Date().toISOString(),
        });

      await app
        .service('sessions')
        .patch(created.id, { status: 'stopped' }, params({ id: userId1 }));
      await db('agents')
        .where({ session_id: created.id, is_primary: 1 })
        .update({ status: 'stopped' });

      await app.service('sessions').onTurnComplete(created.id);

      const remaining = await app
        .get('db')('queued_messages')
        .where({ session_id: created.id, kind: 'turn' });
      expect(remaining).toHaveLength(1);
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

    it('marks the first message with where the prompt came from (Slack)', async () => {
      const createMessage = vi.fn().mockResolvedValue({ id: 99 });
      app.use('messages', { create: createMessage });
      const meta = {
        source: 'slack',
        slack: {
          user_id: 'U1',
          user_name: 'Jan',
          text: 'add tests',
          suggestion: false,
          untagged: false,
        },
      };

      await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId, initial_prompt: 'add tests\n\nSlack context …' }), {
          ...params({ id: userId1 }),
          initialMessageMeta: meta,
        });

      const parsed = JSON.parse(
        createMessage.mock.calls.find(([d]) => d.type === 'user')[0].message_json
      );
      expect(parsed).toMatchObject({ type: 'user', source: 'slack', slack: meta.slack });
      expect(parsed.message.content).toBe('add tests\n\nSlack context …');
    });

    it('leaves an ordinary first message unmarked', async () => {
      const createMessage = vi.fn().mockResolvedValue({ id: 99 });
      app.use('messages', { create: createMessage });
      await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId, initial_prompt: 'Hello' }), params({ id: userId1 }));
      const parsed = JSON.parse(
        createMessage.mock.calls.find(([d]) => d.type === 'user')[0].message_json
      );
      expect(parsed.source).toBeUndefined();
      expect(parsed.slack).toBeUndefined();
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
      expect(generateSessionMetadata).not.toHaveBeenCalled();
      expect(session.label).toBe(`New session #${session.id}`);
      const savedRow = await db('sessions').where({ id: session.id }).first();
      expect(session.remote_branch).toBe(`task-${savedRow.short_id}`);
    });

    it('does not generate metadata for a global session without initial_prompt', async () => {
      const session = await app
        .service('sessions')
        .create(
          { is_global: true, initial_prompt: '', ...testSessionAgentDefaults },
          params({ id: userId1 })
        );

      expect(session.is_global).toBe(true);
      expect(generateSessionMetadata).not.toHaveBeenCalled();
      expect(session.label).toBe(`New session #${session.id}`);
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

      const savedRow = await db('sessions').where({ id: session.id }).first();
      expect(createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'test/repo' }),
        'feature/foo',
        expect.any(String),
        null,
        { localBranch: `feature/foo-${savedRow.short_id}`, baseBranch: 'develop' }
      );
      expect(session.local_branch).toBe(`feature/foo-${savedRow.short_id}`);
      expect(session.remote_branch).toBe('feature/foo');
      expect(session.base_branch).toBe('develop');
      expect(session.pr_number).toBe(42);
      expect(session.pr_url).toBe('https://github.com/test/repo/pull/42');
      expect(session.label).toBe('Feature PR');
      expect(generateSessionMetadata).not.toHaveBeenCalled();
    });

    it('create_new_branch=false strips baguette PR markers into pr_description', async () => {
      const prBody = [
        'Reviewer notes',
        '',
        BAGUETTE_DESCRIPTION_MARKER,
        '---',
        '',
        '## Summary',
        '- Agent write-up',
        '',
        '---',
        '',
        BAGUETTE_FOOTER_MARKER,
        '',
        '_cursor / `gpt-5` · In: 0 · Out: 0 · Cache read: 0 · Cache write: 0 · Cost: $0_',
      ].join('\n');
      getOpenPR.mockResolvedValueOnce({
        number: 7,
        html_url: 'https://github.com/test/repo/pull/7',
        title: 'Feature PR',
        base_ref: 'main',
        draft: false,
        body: prBody,
      });

      const session = await app.service('sessions').create(
        sessionData({
          repo_id: repoId,
          base_branch: 'feature/foo',
          create_new_branch: false,
        }),
        params({ id: userId1 })
      );

      expect(session.pr_description).toBe('## Summary\n- Agent write-up');
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

      const savedRow = await db('sessions').where({ id: session.id }).first();
      expect(session.base_branch).toBe('mainline');
      expect(session.pr_number).toBeNull();
      expect(session.local_branch).toBe(`feature/bar-${savedRow.short_id}`);
      expect(session.remote_branch).toBe('feature/bar');
      expect(session.label).toBe('Continuing: feature/bar');
      expect(generateSessionMetadata).not.toHaveBeenCalled();
      expect(createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'test/repo' }),
        'feature/bar',
        expect.any(String),
        null,
        { localBranch: `feature/bar-${savedRow.short_id}`, baseBranch: 'mainline' }
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

    it('creates a global session in the repos folder without a worktree clone', async () => {
      const session = await app
        .service('sessions')
        .create(
          { is_global: true, initial_prompt: 'Look across all repos', ...testSessionAgentDefaults },
          params({ id: userId1 })
        );

      expect(session.is_global).toBe(true);
      expect(session.codeserver_url).toBeNull();
      expect(session.session_path).toBe('repos');
      expect(session.repo_id).toBeNull();
      expect(session.auto_push).toBeFalsy();
      expect(createWorktree).not.toHaveBeenCalled();
      expect(generateSessionMetadata).toHaveBeenCalled();
    });

    it('forces auto_push off for local repositories', async () => {
      await db('repos').insert({ full_name: 'local-app', repo_path: '/tmp/local-app' });
      const session = await app.service('sessions').create(
        sessionData({
          repo_full_name: 'local-app',
          auto_push: true,
        }),
        params({ id: userId1 })
      );

      expect(session.auto_push).toBeFalsy();
    });

    it('rejects enabling auto_push on patch for local repository sessions', async () => {
      await db('repos').insert({ full_name: 'local-patch', repo_path: '/tmp/local-patch' });
      const created = await app
        .service('sessions')
        .create(sessionData({ repo_full_name: 'local-patch' }), params({ id: userId1 }));

      const patched = await app
        .service('sessions')
        .patch(created.id, { auto_push: true }, params({ id: userId1 }));

      expect(patched.auto_push).toBeFalsy();
    });

    it('uses a title given up front instead of asking the model to invent one', async () => {
      const session = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId, branch_name: 'fix-login' }), {
          ...params({ id: userId1 }),
          initialLabel: 'Fix the login test',
        });

      expect(generateSessionMetadata).not.toHaveBeenCalled();
      expect(session.label).toBe('Fix the login test');
    });

    it('does the same for a global session', async () => {
      const session = await app
        .service('sessions')
        .create(
          { is_global: true, initial_prompt: 'Look across repos', ...testSessionAgentDefaults },
          { ...params({ id: userId1 }), initialLabel: 'Look across repos' }
        );

      expect(generateSessionMetadata).not.toHaveBeenCalled();
      expect(session.label).toBe('Look across repos');
    });

    it('still generates the title when none is given', async () => {
      const session = await app
        .service('sessions')
        .create(sessionData({ repo_id: repoId }), params({ id: userId1 }));
      expect(generateSessionMetadata).toHaveBeenCalled();
      expect(session.label).toBe('Test task');
    });

    it('passes the session so metadata generation uses its selected model', async () => {
      const session = await app
        .service('sessions')
        .create(
          sessionData({ model: 'claude-opus-5', initial_prompt: 'Fix the bug' }),
          params({ id: userId1 })
        );

      expect(generateSessionMetadata).toHaveBeenCalled();
      const forwarded = generateSessionMetadata.mock.calls[0].at(-1);
      expect(forwarded.id).toBe(session.id);
      expect(forwarded.model).toBe('claude-opus-5');
    });

    it('create_new_branch=false allows a second session on a branch already in use', async () => {
      await db('sessions').where({ id: sessId1 }).update({
        local_branch: 'feature/taken-a1b2c3',
        remote_branch: 'feature/taken',
        session_path: '/tmp/wt-taken',
      });

      const session = await app.service('sessions').create(
        sessionData({
          repo_id: repoId,
          base_branch: 'feature/taken',
          create_new_branch: false,
        }),
        params({ id: userId1 })
      );

      const savedRow = await db('sessions').where({ id: session.id }).first();
      expect(session.local_branch).toBe(`feature/taken-${savedRow.short_id}`);
      expect(session.remote_branch).toBe('feature/taken');
      expect(session.local_branch).not.toBe('feature/taken-a1b2c3');
      expect(createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'test/repo' }),
        'feature/taken',
        savedRow.short_id,
        null,
        expect.objectContaining({ localBranch: session.local_branch })
      );
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

      const failed = await db('sessions').where({ remote_branch: 'feature/retry' }).first();
      expect(failed.status).toBe('failed');
      expect(failed.session_path).toBeFalsy();
      expect(removeWorktree).toHaveBeenCalled();

      const session = await app.service('sessions').create(
        sessionData({
          repo_id: repoId,
          base_branch: 'feature/retry',
          create_new_branch: false,
        }),
        params({ id: userId1 })
      );
      expect(session.remote_branch).toBe('feature/retry');
      const savedRow = await db('sessions').where({ id: session.id }).first();
      expect(session.local_branch).toBe(`feature/retry-${savedRow.short_id}`);
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
        expect(session.session_path).toBeFalsy();

        resolveWorktree();
        await app.service('sessions')._awaitProvisioning(session.id);

        const row = await db('sessions').where({ id: session.id }).first();
        expect(row.session_path).toBeTruthy();
        expect(row.status).toBe('stopped');
      } finally {
        resolveWorktree?.();
      }
    });

    it('archives while worktree setup is still in progress', async () => {
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

        await app.service('sessions').archive(session.id, params({ id: userId1 }));

        const row = await db('sessions').where({ id: session.id }).first();
        expect(row.archived_at).toBeTruthy();
        expect(row.status).toBe('archived');
        expect(removeWorktree).toHaveBeenCalled();
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

describe('Sessions service - restartInterruptedSessions', () => {
  const db = createTestDb();

  let app;
  let userId;
  let repoId;

  const seedSession = (overrides = {}) =>
    insertTestSession(db, {
      user_id: userId,
      repo_id: repoId,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'Interrupted task',
      short_id: Math.random().toString(16).slice(2, 10),
      status: 'running',
      ...overrides,
    });

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
    claudeHandleMessageCreated.mockResolvedValue(undefined);
    cursorHandleMessageCreated.mockResolvedValue(undefined);
    loadBaguetteConfig.mockResolvedValue(null);

    await db('users').insert({ github_id: 2001, username: 'alice', approved: true });
    userId = (await db('users').where({ username: 'alice' }).first()).id;
    await db('repos').insert({ full_name: 'test/repo', repo_path: '/tmp/repo' });
    repoId = (await db('repos').where({ full_name: 'test/repo' }).first()).id;

    app = makeApp(db);
    app.service('messages').removeAllListeners('created');
    await app.setup();
  });

  it('resumes a running Claude session that has a stored transcript', async () => {
    const sessId = await seedSession({ claude_session_id: 'claude-abc' });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 1, stopped: 0, failed: 0 });
    expect(await statusTextsFor(sessId)).toEqual(['Server restarted — resuming session']);
    expect(resumeInterruptedReviews).toHaveBeenCalled();

    // The nudge reaches the agent as a collapsible Baguette message, not as a user message.
    const dispatched = userDispatches(claudeHandleMessageCreated);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0][0].session_id).toBe(sessId);
    const parsed = JSON.parse(dispatched[0][0].message_json);
    expect(parsed.source).toBe('baguette');
    expect(parsed.content).toMatch(/interrupted your previous turn/);
  });

  it('routes a Cursor session to the cursor agent', async () => {
    const sessId = await seedSession({ agent_sdk: 'cursor', cursor_agent_id: 'cur-1' });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 1, stopped: 0, failed: 0 });
    const dispatched = userDispatches(cursorHandleMessageCreated);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0][0].session_id).toBe(sessId);
    expect(userDispatches(claudeHandleMessageCreated)).toHaveLength(0);
  });

  it('stops a session with no transcript to resume from and offers a Continue button', async () => {
    const sessId = await seedSession({ claude_session_id: null });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 0, stopped: 1, failed: 0 });
    expect((await db('sessions').where({ id: sessId }).first()).status).toBe('stopped');
    expect(userDispatches(claudeHandleMessageCreated)).toHaveLength(0);

    const [status] = await messagesFor(sessId);
    const parsed = JSON.parse(status.message_json);
    expect(parsed.status).toBe('Server restarted — session was stopped');
    expect(parsed.can_continue).toBe(true);
  });

  it('marks a Cursor session with no stored agent as stopped', async () => {
    await seedSession({ agent_sdk: 'cursor', cursor_agent_id: null, claude_session_id: 'ignored' });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 0, stopped: 1, failed: 0 });
    expect(userDispatches(cursorHandleMessageCreated)).toHaveLength(0);
  });

  it('falls back to stopped when the agent fails to resume', async () => {
    const sessId = await seedSession({ claude_session_id: 'claude-abc' });
    claudeHandleMessageCreated.mockImplementation(async (message) => {
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

  it('leaves sessions waiting on user approval alone on restart', async () => {
    const sessId = await seedSession({ status: 'approval', claude_session_id: 'claude-abc' });

    expect(await app.service('sessions').restartInterruptedSessions()).toEqual({
      restarted: 0,
      stopped: 0,
      failed: 0,
    });
    expect((await db('sessions').where({ id: sessId }).first()).status).toBe('approval');
    expect(claudeHandleMessageCreated).not.toHaveBeenCalled();
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
    expect(claudeHandleMessageCreated).not.toHaveBeenCalled();
    expect(await db('session_messages')).toHaveLength(0);
  });

  it('marks sessions still provisioning as failed and wipes any partial worktree', async () => {
    const sessId = await seedSession({ status: 'provisioning', session_path: null });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 0, stopped: 1, failed: 0 });
    expect((await db('sessions').where({ id: sessId }).first()).status).toBe('failed');
    expect(removeWorktree).toHaveBeenCalled();
  });

  it('finishes sessions left in archiving and sets archived_at', async () => {
    const sessId = await seedSession({ status: 'archiving', session_path: '/tmp/wt' });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 0, stopped: 1, failed: 0 });
    const row = await db('sessions').where({ id: sessId }).first();
    expect(row.archived_at).toBeTruthy();
    expect(row.status).toBe('archived');
    expect(removeWorktree).toHaveBeenCalled();
  });

  it('repairs status when archived_at is set but status is still archiving', async () => {
    const sessId = await seedSession({
      status: 'archiving',
      archived_at: new Date().toISOString(),
      session_path: null,
    });

    await app.service('sessions').restartInterruptedSessions();

    const row = await db('sessions').where({ id: sessId }).first();
    expect(row.status).toBe('archived');
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it('keeps going when one session cannot be recovered at all', async () => {
    const failing = await seedSession({ claude_session_id: 'claude-1' });
    const healthy = await seedSession({ claude_session_id: 'claude-2' });
    claudeHandleMessageCreated.mockImplementation(async (message) => {
      if (message.session_id === failing) throw new Error('boom');
    });

    const result = await app.service('sessions').restartInterruptedSessions();

    expect(result).toEqual({ restarted: 1, stopped: 1, failed: 0 });
    expect((await db('sessions').where({ id: healthy }).first()).status).toBe('running');
  });
});
