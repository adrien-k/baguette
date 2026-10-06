import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { up as agentSdkUp } from '../047_message_agent_sdk.js';

const migrationsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('047_message_agent_sdk', () => {
  let db;

  beforeEach(async () => {
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('knex_migrations', (t) => {
      t.increments('id').primary();
      t.string('name');
      t.integer('batch');
      t.datetime('migration_time');
    });
    const files = fs
      .readdirSync(migrationsPath)
      .filter((f) => f.endsWith('.js') && f < '047_message_agent_sdk.js')
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
      agent_sdk: 'cursor',
      review_agent_sdk: 'claude',
    });

    await db('session_messages').insert([
      {
        session_id: sessionId,
        type: 'user',
        message_json: '{}',
        agent_type: 'builder',
      },
      {
        session_id: sessionId,
        type: 'user',
        message_json: '{}',
        agent_type: 'reviewer',
      },
    ]);

    await db('queued_messages').insert({
      session_id: sessionId,
      user_id: userId,
      message_json: '{}',
      kind: 'turn',
    });

    await agentSdkUp(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('backfills agent_sdk from session agent_sdk columns', async () => {
    const rows = await db('session_messages').orderBy('id', 'asc');
    expect(rows[0].agent_sdk).toBe('cursor');
    expect(rows[1].agent_sdk).toBe('claude');
  });

  it('adds agent_type to queued_messages', async () => {
    expect(await db.schema.hasColumn('queued_messages', 'agent_type')).toBe(true);
  });

  it('backfills agent_sdk on queued_messages from session agent_sdk', async () => {
    expect(await db.schema.hasColumn('queued_messages', 'agent_sdk')).toBe(true);
    const row = await db('queued_messages').first();
    expect(row.agent_sdk).toBe('cursor');
  });
});
