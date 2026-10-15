import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';

describe('074_usage_nullable_session_id', () => {
  let knex;

  beforeEach(async () => {
    knex = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await knex.schema.createTable('users', (t) => {
      t.increments('id');
    });
    await knex.schema.createTable('sessions', (t) => {
      t.increments('id');
    });
    await knex.schema.createTable('usage', (t) => {
      t.increments('id');
      t.integer('session_id').references('id').inTable('sessions').notNullable();
      t.integer('user_id').references('id').inTable('users').notNullable();
      t.string('repo_full_name').notNullable();
      t.decimal('cost_usd').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.string('agent_sdk').notNullable().defaultTo('claude');
      t.integer('input_tokens').notNullable().defaultTo(0);
      t.integer('output_tokens').notNullable().defaultTo(0);
      t.integer('cache_read_tokens').notNullable().defaultTo(0);
      t.integer('cache_write_tokens').notNullable().defaultTo(0);
      t.integer('reasoning_tokens').notNullable().defaultTo(0);
      t.integer('total_tokens').notNullable().defaultTo(0);
    });
    await knex('users').insert({ id: 1 });
    await knex('sessions').insert({ id: 10 });
    await knex('usage').insert({
      session_id: 10,
      user_id: 1,
      repo_full_name: 'org/repo',
      cost_usd: 0.5,
    });
    const mod = await import('../074_usage_nullable_session_id.js');
    await mod.up(knex);
  });

  afterEach(async () => {
    await knex.destroy();
  });

  it('allows null session_id after migration', async () => {
    await knex('usage').where({ id: 1 }).update({ session_id: null });
    const row = await knex('usage').where({ id: 1 }).first();
    expect(row.session_id).toBeNull();
  });
});
