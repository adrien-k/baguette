import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { up as keyUp } from '../047_session_messages_tool_call_started_at_key.js';

const migrationsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('047_session_messages_tool_call_started_at_key', () => {
  let db;

  beforeEach(async () => {
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // Apply migrations 001..046 directly so the schema matches production
    // (column shape from 045 + the index from 045's up).
    await db.schema.createTable('knex_migrations', (t) => {
      t.increments('id').primary();
      t.string('name');
      t.integer('batch');
      t.datetime('migration_time');
    });
    const files = fs
      .readdirSync(migrationsPath)
      .filter((f) => f.endsWith('.js') && f < '047_session_messages_tool_call_started_at_key.js')
      .sort();
    for (const file of files) {
      const mod = await import(pathToFileURL(path.join(migrationsPath, file)).href);
      await mod.up(db);
    }

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
    db._sessionId = sessionId;

    await keyUp(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const insertToolCall = async ({ toolCallId, startedAt, status = 'running' }) =>
    db('session_messages').insert({
      session_id: db._sessionId,
      type: 'tool_call',
      message_json: JSON.stringify({ type: 'tool_call', id: toolCallId, status }),
      turn_id: 1,
      tool_call_id: toolCallId,
      tool_status: status,
      tool_started_at: startedAt,
      tool_ended_at: null,
    });

  it('allows the same tool_call_id at distinct tool_started_at (Cursor SDK re-use)', async () => {
    const callId = 'tool_e154221a-6dd9-402f-929b-c31037b2321';

    await insertToolCall({
      toolCallId: callId,
      startedAt: '2026-10-06T19:48:17.857Z',
    });
    // Second invocation 28s later, same id (the failure case from session 49972718).
    await expect(
      insertToolCall({ toolCallId: callId, startedAt: '2026-10-06T19:48:46.922Z' })
    ).resolves.toBeDefined();

    const rows = await db('session_messages')
      .where({ session_id: db._sessionId, tool_call_id: callId })
      .orderBy('id', 'asc');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.tool_started_at)).toEqual([
      '2026-10-06T19:48:17.857Z',
      '2026-10-06T19:48:46.922Z',
    ]);
  });

  it('still rejects duplicate (session_id, tool_call_id, tool_started_at) rows', async () => {
    const callId = 'tool_dup';
    const startedAt = '2026-10-06T19:48:17.000Z';
    await insertToolCall({ toolCallId: callId, startedAt });
    await expect(insertToolCall({ toolCallId: callId, startedAt })).rejects.toThrow(
      /UNIQUE constraint failed/
    );
  });

  it('does not affect rows where tool_call_id is NULL', async () => {
    await db('session_messages').insert({
      session_id: db._sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', content: 'hi' }),
      turn_id: 1,
      tool_call_id: null,
    });
    await db('session_messages').insert({
      session_id: db._sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', content: 'again' }),
      turn_id: 1,
      tool_call_id: null,
    });
    const userRows = await db('session_messages').where({ type: 'user' });
    expect(userRows).toHaveLength(2);
  });
});
