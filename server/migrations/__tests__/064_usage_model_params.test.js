import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';

describe('064_usage_model_params', () => {
  let knex;

  beforeEach(async () => {
    knex = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await knex.schema.createTable('agents', (t) => {
      t.increments('id');
      t.text('model_params');
    });
    await knex.schema.createTable('usage', (t) => {
      t.increments('id');
      t.integer('agent_id');
      t.text('model_params');
    });
    await knex('agents').insert([
      { id: 1, model_params: JSON.stringify([{ id: 'fast', value: 'true' }]) },
      { id: 2, model_params: null },
    ]);
    await knex('usage').insert([
      { agent_id: 1, model_params: null },
      { agent_id: 2, model_params: null },
      { agent_id: null, model_params: null },
    ]);
    const mod = await import('../064_usage_model_params.js');
    await mod.up(knex);
  });

  afterEach(async () => {
    await knex.destroy();
  });

  it('backfills model_params from agents', async () => {
    const rows = await knex('usage').orderBy('id');
    expect(rows[0].model_params).toBe(JSON.stringify([{ id: 'fast', value: 'true' }]));
    expect(rows[1].model_params).toBeNull();
    expect(rows[2].model_params).toBeNull();
  });
});
