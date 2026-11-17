import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { up, down } from '../092_users_utility_defaults.js';

describe('092_users_utility_defaults', () => {
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
    });
    await db.schema.createTable('agent_configs', (t) => {
      t.increments('id').primary();
      t.integer('user_id');
      t.string('sdk');
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('adds the utility default columns and allows config references', async () => {
    await up(db);
    const [configId] = await db('agent_configs').insert({ user_id: null, sdk: 'claude' });
    const [userId] = await db('users').insert({
      github_id: 1,
      username: 'u',
      utility_default_config_id: configId,
      utility_default_model: JSON.stringify({ model: 'haiku' }),
    });
    const row = await db('users').where({ id: userId }).first();
    expect(row.utility_default_config_id).toBe(configId);
    expect(JSON.parse(row.utility_default_model).model).toBe('haiku');
  });

  it('is idempotent', async () => {
    await up(db);
    await up(db);
    const hasConfig = await db.schema.hasColumn('users', 'utility_default_config_id');
    const hasModel = await db.schema.hasColumn('users', 'utility_default_model');
    expect(hasConfig).toBe(true);
    expect(hasModel).toBe(true);
  });

  it('down removes the columns', async () => {
    await up(db);
    await down(db);
    expect(await db.schema.hasColumn('users', 'utility_default_config_id')).toBe(false);
    expect(await db.schema.hasColumn('users', 'utility_default_model')).toBe(false);
  });
});
