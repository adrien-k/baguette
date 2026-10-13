import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
describe('063_usage_agent_type', () => {
  let knex;

  beforeEach(async () => {
    knex = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await knex.schema.createTable('agents', (t) => {
      t.increments('id');
      t.integer('session_id');
      t.string('agent_type');
    });
    await knex.schema.createTable('usage', (t) => {
      t.increments('id');
      t.integer('session_id');
      t.integer('agent_id');
      t.string('kind');
      t.decimal('cost_usd');
    });
    await knex('agents').insert([
      { id: 1, session_id: 10, agent_type: 'builder' },
      { id: 2, session_id: 10, agent_type: 'reviewer' },
    ]);
    await knex('usage').insert([
      { session_id: 10, agent_id: 1, kind: null, cost_usd: 0 },
      { session_id: 10, agent_id: 2, kind: 'review', cost_usd: 0 },
      { session_id: 10, agent_id: null, kind: 'review', cost_usd: 0 },
      { session_id: 10, agent_id: null, kind: null, cost_usd: 0 },
    ]);
    const mod = await import('../063_usage_agent_type.js');
    await mod.up(knex);
  });

  afterEach(async () => {
    await knex.destroy();
  });

  it('backfills agent_type and drops kind', async () => {
    expect(await knex.schema.hasColumn('usage', 'kind')).toBe(false);
    const rows = await knex('usage').orderBy('id');
    expect(rows.map((r) => r.agent_type)).toEqual(['builder', 'reviewer', 'reviewer', 'builder']);
  });
});
