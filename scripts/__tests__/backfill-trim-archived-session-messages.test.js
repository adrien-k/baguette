import { describe, it, expect } from 'vitest';
import {
  createTestDb,
  insertTestSession,
  getPrimaryBuilderAgentId,
} from '../../server/test-utils/db.js';
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
  const sessionId = await insertTestSession(db, {
    user_id: user.id,
    repo_id: repo.id,
    repo_full_name: 'o/r',
    short_id: shortId,
    initial_prompt: 'x',
    base_branch: 'main',
    status: archived ? 'archived' : 'stopped',
    archived_at: archived ? new Date().toISOString() : null,
  });
  const builderAgentId = await getPrimaryBuilderAgentId(db, sessionId);
  return { sessionId, builderAgentId };
}

describe('backfill-trim-archived-session-messages', () => {
  it('trims only archived sessions and is idempotent', async () => {
    const { sessionId: archivedId, builderAgentId: archivedBuilderId } = await seedSession({
      archived: true,
      shortId: 'arch',
    });
    const { sessionId: activeId, builderAgentId: activeBuilderId } = await seedSession({
      archived: false,
      shortId: 'live',
    });

    const insertNoise = (sessionId, agentId) =>
      db('session_messages').insert([
        {
          session_id: sessionId,
          agent_id: agentId,
          type: 'user',
          message_json: JSON.stringify({ type: 'user', content: 'hi' }),
        },
        {
          session_id: sessionId,
          agent_id: agentId,
          type: 'tool_call',
          message_json: JSON.stringify({ type: 'tool_call', id: 't1' }),
        },
        {
          session_id: sessionId,
          agent_id: agentId,
          type: 'system',
          subtype: 'status',
          message_json: JSON.stringify({ type: 'system', subtype: 'status' }),
        },
      ]);

    await insertNoise(archivedId, archivedBuilderId);
    await insertNoise(activeId, activeBuilderId);

    const first = await backfillTrimArchivedSessionMessages(db);
    expect(first.sessions).toBe(1);
    expect(first.rowsDeleted).toBeGreaterThan(0);

    const archivedRemaining = await db('session_messages').where({ session_id: archivedId });
    expect(archivedRemaining.map((r) => r.type)).toEqual(['user']);

    const activeRemaining = await db('session_messages').where({ session_id: activeId });
    expect(activeRemaining).toHaveLength(3);

    const second = await backfillTrimArchivedSessionMessages(db);
    expect(second.rowsDeleted).toBe(0);
  });
});
