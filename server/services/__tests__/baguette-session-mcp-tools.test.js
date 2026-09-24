import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { buildBaguetteSessionMcpTools } from '../baguette-session-mcp-tools.js';

const db = createTestDb({ beforeEach, afterEach });

function parseOk(result) {
  const text = result.content[0].text;
  return JSON.parse(text);
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
      created_branch: 'feat/auth',
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
    await app.setup();
    tools = buildBaguetteSessionMcpTools({ id: userId }, app);
  });

  it('SearchSessions filters by q and base_branch', async () => {
    const search = tools.find((t) => t.name === 'SearchSessions');
    const out = parseOk(await search.handler({ q: 'auth', base_branch: 'main' }));
    expect(out.ok).toBe(true);
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].id).toBe(sessionId);
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
});
