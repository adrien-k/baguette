import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../server/test-utils/db.js';
import { backfillMessageRows } from '../2026100601_backfill-message-rows.js';

const db = createTestDb();

async function seedSession(sessionShortId) {
  const [userId] = await db('users').insert({
    github_id: 1,
    username: 't',
    approved: true,
  });
  const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  const [sessionId] = await db('sessions').insert({
    user_id: userId,
    repo_id: repoId,
    repo_full_name: 'o/r',
    short_id: sessionShortId,
    initial_prompt: 'x',
    base_branch: 'main',
    local_branch: 'feat',
    status: 'stopped',
    session_path: '/tmp/wt',
    agent_sdk: 'claude',
    model: 'sonnet',
  });
  return sessionId;
}

describe('backfill-message-rows', () => {
  it('merges tool-result user rows into typed tool_call rows', async () => {
    const sessionId = await seedSession('bf');
    const toolUseId = 'toolu_abc';
    const createdAt = new Date().toISOString();
    await db('session_messages').insert([
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'run it' }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: toolUseId,
                name: 'Bash',
                input: { command: 'echo hi' },
              },
            ],
          },
        }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUseId,
                content: '{"stdout":"hi\\n","stderr":"","exit_code":0}',
              },
            ],
          },
        }),
        created_at: createdAt,
      },
    ]);

    const counts = await backfillMessageRows(db);
    expect(counts.mergedToolResults).toBe(1);
    expect(counts.toolCallsRewritten).toBe(1);

    const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id', 'asc');
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe('user');
    expect(rows[0].turn_id).toBe(1);
    const toolRow = rows[1];
    expect(toolRow.type).toBe('tool_call');
    expect(toolRow.tool_call_id).toBe(toolUseId);
    expect(toolRow.tool_status).toBe('completed');
    const payload = JSON.parse(toolRow.message_json);
    expect(payload.kind).toBe('bash');
    expect(payload.result).toEqual({
      status: 'ok',
      error_message: null,
      exit_code: 0,
      stdout: 'hi\n',
      stderr: '',
    });

    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.current_turn_id).toBe(1);
  });

  it('drops duplicate assistant tool_use rows that share a tool_call_id', async () => {
    const sessionId = await seedSession('bf-dup');
    const toolUseId = 'call-dup-1';
    const createdAt = new Date().toISOString();
    await db('session_messages').insert([
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'run' }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: toolUseId,
                name: 'Bash',
                input: { command: 'echo hi' },
              },
            ],
          },
        }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: toolUseId,
                name: 'Bash',
                input: { command: 'echo hi' },
              },
            ],
          },
        }),
        created_at: createdAt,
      },
    ]);

    const counts = await backfillMessageRows(db);
    expect(counts.duplicateToolCallRowsRemoved).toBe(1);
    expect(counts.toolCallsRewritten).toBe(1);

    const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id', 'asc');
    expect(rows).toHaveLength(2);
    expect(rows[1].type).toBe('tool_call');
    expect(rows[1].tool_call_id).toBe(toolUseId);
  });

  it('stamps turns across builder and reviewer rows in the shared table', async () => {
    const sessionId = await seedSession('bf2');
    const createdAt = new Date().toISOString();
    await db('session_messages').insert([
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'build it' }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'result',
        subtype: 'success',
        message_json: JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.05 }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'reviewer',
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'review it' }),
        created_at: createdAt,
      },
    ]);

    const counts = await backfillMessageRows(db);
    expect(counts.turnResultsRewritten).toBe(1);

    const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id', 'asc');
    expect(rows[0].turn_id).toBe(1);
    expect(rows[1].turn_id).toBe(1);
    expect(rows[1].type).toBe('turn_result');
    expect(JSON.parse(rows[1].message_json)).toMatchObject({ type: 'turn_result', status: 'ok' });
    expect(rows[2].turn_id).toBe(2);
    expect(rows[2].agent_type).toBe('reviewer');

    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.current_turn_id).toBe(2);
  });
});
