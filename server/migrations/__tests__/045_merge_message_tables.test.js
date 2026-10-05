import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { up as mergeUp } from '../045_merge_message_tables.js';

const migrationsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('045_merge_message_tables', () => {
  let db;

  beforeEach(async () => {
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // Apply migrations 001..044 directly (knex 3 migrate.up runs one at a time).
    await db.schema.createTable('knex_migrations', (t) => {
      t.increments('id').primary();
      t.string('name');
      t.integer('batch');
      t.datetime('migration_time');
    });
    const files = fs
      .readdirSync(migrationsPath)
      .filter((f) => f.endsWith('.js') && f < '045_merge_message_tables.js')
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

    await db('session_messages').insert([
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'hello' }),
      },
      {
        session_id: sessionId,
        type: 'assistant',
        message_json: JSON.stringify({ type: 'assistant', blocks: [] }),
      },
    ]);
    await db('session_review_messages').insert([
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'review please' }),
      },
      {
        session_id: sessionId,
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify({ type: 'system', subtype: 'status', status: 'running' }),
      },
    ]);

    await mergeUp(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('folds review messages into session_messages with agent_type reviewer', async () => {
    expect(await db.schema.hasTable('session_review_messages')).toBe(false);

    const rows = await db('session_messages').orderBy('id', 'asc');
    expect(rows).toHaveLength(4);
    expect(rows[0].agent_type).toBe('builder');
    expect(rows[1].agent_type).toBe('builder');
    expect(rows[2].agent_type).toBe('reviewer');
    expect(JSON.parse(rows[2].message_json).content).toBe('review please');
    expect(rows[3].agent_type).toBe('reviewer');
    expect(rows[3].subtype).toBe('status');
  });

  it('adds the sessions turn columns', async () => {
    expect(await db.schema.hasColumn('sessions', 'current_turn_id')).toBe(true);
    expect(await db.schema.hasColumn('sessions', 'active_chat_turn_id')).toBe(true);
    expect(await db.schema.hasColumn('sessions', 'active_review_turn_id')).toBe(true);
    expect(await db.schema.hasColumn('session_messages', 'turn_id')).toBe(true);
    expect(await db.schema.hasColumn('session_messages', 'tool_call_id')).toBe(true);
  });
});
