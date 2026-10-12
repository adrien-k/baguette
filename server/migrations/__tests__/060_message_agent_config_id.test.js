import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { up, down } from '../060_message_agent_config_id.js';

describe('060_message_agent_config_id', () => {
  let db;

  beforeEach(async () => {
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('agent_configs', (t) => {
      t.increments('id').primary();
    });
    await db.schema.createTable('session_messages', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
    });
    await db.schema.createTable('queued_messages', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('adds nullable agent_config_id to both tables', async () => {
    await up(db);
    await db('agent_configs').insert({ id: 7 });
    await db('session_messages').insert({ session_id: 1, agent_config_id: 7 });
    await db('queued_messages').insert({ session_id: 1 });
    expect((await db('session_messages').first()).agent_config_id).toBe(7);
    expect((await db('queued_messages').first()).agent_config_id).toBeNull();
  });

  it('is idempotent', async () => {
    await up(db);
    await up(db);
    expect(await db.schema.hasColumn('session_messages', 'agent_config_id')).toBe(true);
  });

  it('down removes the columns', async () => {
    await up(db);
    await down(db);
    expect(await db.schema.hasColumn('session_messages', 'agent_config_id')).toBe(false);
    expect(await db.schema.hasColumn('queued_messages', 'agent_config_id')).toBe(false);
  });
});
