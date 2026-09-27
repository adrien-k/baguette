import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { buildBaguetteSessionMcpTools } from '../baguette-session-mcp-tools.js';

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  };
});

const db = createTestDb({ beforeEach, afterEach });

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

function parseOk(result) {
  const out = parseResult(result);
  expect(out.ok).toBe(true);
  return out;
}

describe('baguette session MCP tools', () => {
  let app;
  let userId;
  let sessionId;
  let tools;

  beforeEach(async () => {
    [userId] = await db('users').insert({ github_id: 99, username: 'mcp', approved: true });
    const [repoId] = await db('repos').insert({ full_name: 'o/r', bare_path: '/tmp/r' });
    await db('user_repos').insert({ user_id: userId, repo_id: repoId });
    [sessionId] = await db('sessions').insert({
      user_id: userId,
      repo_id: repoId,
      repo_full_name: 'o/r',
      short_id: 'abcd',
      label: 'Fix auth bug',
      initial_prompt: 'Please fix login',
      base_branch: 'main',
      local_branch: 'feat/auth',
      status: 'stopped',
    });
    await db('session_messages').insert([
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      },
      {
        session_id: sessionId,
        type: 'assistant',
        message_json: JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: 'hello' },
        }),
      },
    ]);

    app = feathers();
    app.set('db', db);
    registerSessionsService(app);
    app.use(
      'claude-agent',
      {
        onMessageCreated: vi.fn().mockResolvedValue(undefined),
        syncSessionSettingsFromPatch: vi.fn(),
      },
      { methods: ['onMessageCreated', 'syncSessionSettingsFromPatch'] }
    );
    registerQueuedMessagesService(app);
    registerMessagesService(app);
    await app.setup();
    tools = buildBaguetteSessionMcpTools({ id: userId }, app, {
      callerSession: { id: sessionId, is_global: false },
    });
  });

  it('SearchSessions filters by q and base_branch', async () => {
    const search = tools.find((t) => t.name === 'SearchSessions');
    const out = parseOk(await search.handler({ q: 'auth', base_branch: 'main' }));
    expect(out.ok).toBe(true);
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].id).toBe(sessionId);
  });

  it('SearchSessions filters by remote_branch and returns each local_branch', async () => {
    const repoId = (await db('repos').where({ full_name: 'o/r' }).first()).id;
    const sharedRemote = 'feature/shared-head';
    await db('sessions').insert({
      user_id: userId,
      repo_id: repoId,
      repo_full_name: 'o/r',
      short_id: 'bbbb',
      label: 'Second on shared head',
      initial_prompt: 'More work',
      base_branch: 'main',
      local_branch: 'feature/shared-head-bbbb',
      remote_branch: sharedRemote,
      status: 'stopped',
    });
    await db('sessions')
      .where({ id: sessionId })
      .update({ remote_branch: sharedRemote, local_branch: 'feature/shared-head-abcd' });

    const search = tools.find((t) => t.name === 'SearchSessions');
    const out = parseOk(await search.handler({ remote_branch: sharedRemote }));
    expect(out.sessions).toHaveLength(2);
    const locals = out.sessions.map((s) => s.local_branch).sort();
    expect(locals).toEqual(['feature/shared-head-abcd', 'feature/shared-head-bbbb']);
  });

  it('GetSession returns message count and last assistant', async () => {
    const get = tools.find((t) => t.name === 'GetSession');
    const out = parseOk(await get.handler({ session_id: sessionId }));
    expect(out.message_count).toBe(2);
    expect(out.initial_prompt).toBe('Please fix login');
    expect(out.last_assistant_message.message.content).toBe('hello');
  });

  it('GetSessionMessage supports byte ranges', async () => {
    const [msgId] = await db('session_messages')
      .where({ session_id: sessionId, type: 'assistant' })
      .pluck('id');
    const getMsg = tools.find((t) => t.name === 'GetSessionMessage');
    const out = parseOk(await getMsg.handler({ session_id: sessionId, message_id: msgId }));
    expect(out.message_json).toContain('hello');
  });

  it('CreateSessionMessage sends immediately when session is idle', async () => {
    const create = tools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseOk(await create.handler({ session_id: sessionId, text: 'ping' }));
    expect(out.message_id).toBeTruthy();
    const row = await db('session_messages').where({ id: out.message_id }).first();
    const parsed = JSON.parse(row.message_json);
    expect(parsed.message.content).toBe('ping');
    expect(parsed.source).toBe('mcp');
    expect(row.subtype).toBe('mcp');
  });

  it('CreateSessionMessage schedules with send_at', async () => {
    const sendAt = new Date(Date.now() + 120_000).toISOString();
    const create = tools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseOk(
      await create.handler({ session_id: sessionId, text: 'later', send_at: sendAt })
    );
    expect(out.scheduled).toBe(true);
    expect(out.queued_message_id).toBeTruthy();
    const queued = await db('queued_messages').where({ id: out.queued_message_id }).first();
    expect(queued.kind).toBe('scheduled');
    expect(JSON.parse(queued.message_json).message.content).toBe('later');
  });

  it('CreateSessionMessage rejects another session for repo agents', async () => {
    const [otherId] = await db('sessions').insert({
      user_id: userId,
      repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
      repo_full_name: 'o/r',
      short_id: 'efgh',
      label: 'Other',
      initial_prompt: 'Other task',
      base_branch: 'main',
      local_branch: 'feat/other',
      status: 'stopped',
    });
    const create = tools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseResult(await create.handler({ session_id: otherId, text: 'nope' }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/global Baguette session/);
  });

  it('CreateSessionMessage allows global agent to post to another session', async () => {
    const [globalId] = await db('sessions').insert({
      user_id: userId,
      is_global: true,
      repo_full_name: '',
      worktree_path: 'repos',
      base_branch: '',
      short_id: 'glob01',
      label: 'Global',
      initial_prompt: 'Orchestrate',
      status: 'stopped',
    });
    const [targetId] = await db('sessions').insert({
      user_id: userId,
      repo_id: (await db('repos').where({ full_name: 'o/r' }).first()).id,
      repo_full_name: 'o/r',
      short_id: 'targ01',
      label: 'Target',
      initial_prompt: 'Work',
      base_branch: 'main',
      local_branch: 'feat/target',
      status: 'stopped',
    });
    const globalTools = buildBaguetteSessionMcpTools({ id: userId }, app, {
      callerSession: { id: globalId, is_global: true },
    });
    const create = globalTools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseOk(await create.handler({ session_id: targetId, text: 'from global' }));
    expect(out.message_id).toBeTruthy();
  });

  it('CreateSessionMessage allows external MCP to post to an owned session', async () => {
    const externalTools = buildBaguetteSessionMcpTools({ id: userId }, app);
    const create = externalTools.find((t) => t.name === 'CreateSessionMessage');
    const out = parseOk(await create.handler({ session_id: sessionId, text: 'from external mcp' }));
    expect(out.message_id).toBeTruthy();
  });
});
