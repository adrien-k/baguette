import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { up } from '../059_usage_agent_config_id.js';

describe('059_usage_agent_config_id', () => {
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
    await db.schema.createTable('sessions', (t) => {
      t.increments('id').primary();
      t.integer('agent_config_id');
      t.integer('review_agent_config_id');
    });
    await db.schema.createTable('usage', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
      t.string('kind');
      t.decimal('cost_usd', 12, 6);
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('backfills agent_config_id from session in one pass', async () => {
    await db('agent_configs').insert([{ id: 10 }, { id: 20 }]);
    const [sessionId] = await db('sessions').insert({
      agent_config_id: 10,
      review_agent_config_id: 20,
    });
    await db('usage').insert([
      { session_id: sessionId, kind: null, cost_usd: 0 },
      { session_id: sessionId, kind: 'review', cost_usd: 0 },
      { session_id: sessionId, kind: 'chat', cost_usd: 0 },
    ]);

    await up(db);

    const rows = await db('usage').orderBy('id');
    expect(rows[0].agent_config_id).toBe(10);
    expect(rows[1].agent_config_id).toBe(20);
    expect(rows[2].agent_config_id).toBe(10);
  });
});
