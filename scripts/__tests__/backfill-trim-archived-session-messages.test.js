import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../server/test-utils/db.js';
import { backfillTrimArchivedSessionMessages } from '../2026100603_backfill-trim-archived-session-messages.js';

const db = createTestDb();

async function seedSession({ archived = false, shortId }) {
  let user = await db('users').where({ username: 't' }).first();
  if (!user) {
    const [userId] = await db('users').insert({
      github_id: 1,
      username: 't',
      approved: true,
    });
    user = { id: userId };
  }
  let repo = await db('repos').where({ full_name: 'o/r' }).first();
  if (!repo) {
    const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
    repo = { id: repoId };
  }
  const [sessionId] = await db('sessions').insert({
    user_id: user.id,
    repo_id: repo.id,
    repo_full_name: 'o/r',
    short_id: shortId,
    initial_prompt: 'x',
    base_branch: 'main',
    status: archived ? 'archived' : 'stopped',
    archived_at: archived ? new Date().toISOString() : null,
  });
  return sessionId;
}

describe('backfill-trim-archived-session-messages', () => {
  it('trims only archived sessions and is idempotent', async () => {
    const archivedId = await seedSession({ archived: true, shortId: 'arch' });
    const activeId = await seedSession({ archived: false, shortId: 'live' });

    const insertNoise = (sessionId) =>
      db('session_messages').insert([
        {
          session_id: sessionId,
          agent_type: 'builder',
          type: 'user',
          message_json: JSON.stringify({ type: 'user', content: 'hi' }),
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
          type: 'system',
          subtype: 'status',
          message_json: JSON.stringify({ type: 'system', subtype: 'status' }),
        },
      ]);

    await insertNoise(archivedId);
    await insertNoise(activeId);

    const first = await backfillTrimArchivedSessionMessages(db);
    expect(first).toEqual({ sessions: 1, rowsDeleted: 2 });

    const archivedTypes = await db('session_messages')
      .where({ session_id: archivedId })
      .orderBy('id', 'asc')
      .pluck('type');
    expect(archivedTypes).toEqual(['user']);

    const activeTypes = await db('session_messages')
      .where({ session_id: activeId })
      .orderBy('id', 'asc')
      .pluck('type');
    expect(activeTypes).toEqual(['user', 'tool_call', 'system']);

    const second = await backfillTrimArchivedSessionMessages(db);
    expect(second).toEqual({ sessions: 1, rowsDeleted: 0 });
  });
});
