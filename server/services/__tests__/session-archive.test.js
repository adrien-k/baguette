import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { trimSessionMessagesForArchive } from '../session-archive.js';

const db = createTestDb();

describe('trimSessionMessagesForArchive', () => {
  let sessionId;

  beforeEach(async () => {
    await db('users').insert({ github_id: 1, username: 'u1', approved: true });
    const user = await db('users').where({ username: 'u1' }).first();
    const [repoId] = await db('repos').insert({
      full_name: 'org/repo',
      stripped_name: 'org/repo',
      repo_path: '/tmp/bare',
    });
    [sessionId] = await db('sessions').insert({
      user_id: user.id,
      repo_id: repoId,
      repo_full_name: 'org/repo',
      initial_prompt: 'task',
      short_id: 'abcd1234',
      base_branch: 'main',
      remote_branch: 'feat/x',
      local_branch: 'feat/x-abcd1234',
    });
  });

  it('removes non user/assistant rows and keeps baguette user prompts', async () => {
    await db('session_messages').insert([
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'user',
        message_json: JSON.stringify({ type: 'user', source: 'baguette', content: 'go' }),
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'hello' }),
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: JSON.stringify({ type: 'assistant', blocks: [] }),
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify({ type: 'system', subtype: 'status', status: 'ok' }),
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'tool_call',
        message_json: JSON.stringify({ type: 'tool_call', id: 't1' }),
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'turn_result',
        message_json: JSON.stringify({ type: 'turn_result' }),
      },
      {
        session_id: sessionId,
        type: 'assistant',
        agent_type: 'reviewer',
        message_json: JSON.stringify({ type: 'assistant', blocks: [] }),
      },
    ]);

    await trimSessionMessagesForArchive(db, sessionId);

    const remaining = await db('session_messages')
      .where({ session_id: sessionId })
      .orderBy('id', 'asc');
    expect(remaining.map((r) => r.type)).toEqual(['user', 'user', 'assistant', 'assistant']);
    expect(remaining[0].message_json).toContain('baguette');
  });

  it('removes thinking-only assistant rows and strips thinking blocks from mixed rows', async () => {
    await db('session_messages').insert([
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: JSON.stringify({
          type: 'assistant',
          blocks: [{ type: 'thinking', thinking: 'ponder' }],
        }),
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: JSON.stringify({
          type: 'assistant',
          blocks: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: 'Hello' },
          ],
        }),
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'system',
        subtype: 'thinking_tokens',
        message_json: JSON.stringify({
          type: 'system',
          subtype: 'thinking_tokens',
          thinking_tokens: 42,
        }),
      },
    ]);

    await trimSessionMessagesForArchive(db, sessionId);

    const remaining = await db('session_messages')
      .where({ session_id: sessionId })
      .orderBy('id', 'asc');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].type).toBe('assistant');
    const payload = JSON.parse(remaining[0].message_json);
    expect(payload.blocks).toEqual([{ type: 'text', text: 'Hello' }]);
  });
});
