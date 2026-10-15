import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { up as keyUp } from '../073_session_messages_agent_tool_call_started_at_key.js';

describe('073_session_messages_agent_tool_call_started_at_key', () => {
  let db;

  beforeEach(async () => {
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.integer('github_id');
      t.string('username');
      t.boolean('approved');
    });
    await db.schema.createTable('repos', (t) => {
      t.increments('id').primary();
      t.string('full_name');
      t.string('bare_path');
    });
    await db.schema.createTable('sessions', (t) => {
      t.increments('id').primary();
      t.integer('user_id');
      t.integer('repo_id');
      t.string('repo_full_name');
      t.string('base_branch');
      t.text('initial_prompt');
    });
    await db.schema.createTable('agents', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
    });
    await db.schema.createTable('session_messages', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
      t.integer('agent_id');
      t.string('type').notNullable();
      t.text('message_json').notNullable();
      t.integer('turn_id');
      t.string('tool_call_id');
      t.string('tool_status');
      t.string('tool_started_at');
      t.string('tool_ended_at');
    });
    await db.raw(
      'CREATE UNIQUE INDEX session_messages_agent_tool_call_idx ON session_messages (agent_id, tool_call_id) WHERE tool_call_id IS NOT NULL'
    );

    const [userId] = await db('users').insert({
      github_id: 1,
      username: 't',
      approved: true,
    });
    const [repoId] = await db('repos').insert({ full_name: 'o/r', bare_path: '/tmp/r' });
    const [sessionId] = await db('sessions').insert({
      user_id: userId,
      repo_id: repoId,
      repo_full_name: 'o/r',
      base_branch: 'main',
      initial_prompt: 'x',
    });
    const [agentId] = await db('agents').insert({ session_id: sessionId });
    db._sessionId = sessionId;
    db._agentId = agentId;

    await keyUp(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const insertToolCall = async ({ toolCallId, startedAt, status = 'running' }) =>
    db('session_messages').insert({
      session_id: db._sessionId,
      agent_id: db._agentId,
      type: 'tool_call',
      message_json: JSON.stringify({ type: 'tool_call', id: toolCallId, status }),
      turn_id: 1,
      tool_call_id: toolCallId,
      tool_status: status,
      tool_started_at: startedAt,
      tool_ended_at: null,
    });

  it('allows the same tool_call_id at distinct tool_started_at (Cursor SDK re-use)', async () => {
    const callId = 'tool_6e927103-e847-47e7-a9c5-a4e0b52354a';

    await insertToolCall({
      toolCallId: callId,
      startedAt: '2026-10-15T08:39:01.000Z',
    });
    await expect(
      insertToolCall({ toolCallId: callId, startedAt: '2026-10-15T08:39:29.972Z' })
    ).resolves.toBeDefined();

    const rows = await db('session_messages')
      .where({ agent_id: db._agentId, tool_call_id: callId })
      .orderBy('id', 'asc');
    expect(rows).toHaveLength(2);
  });

  it('still rejects duplicate (agent_id, tool_call_id, tool_started_at) rows', async () => {
    const callId = 'tool_dup';
    const startedAt = '2026-10-15T08:39:29.972Z';
    await insertToolCall({ toolCallId: callId, startedAt });
    await expect(insertToolCall({ toolCallId: callId, startedAt })).rejects.toThrow(
      /UNIQUE constraint failed/
    );
  });
});
