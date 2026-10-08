import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { up } from '../054_sessions_auto_push_local_repos.js';

describe('054_sessions_auto_push_local_repos', () => {
  let db;

  beforeEach(async () => {
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('repos', (t) => {
      t.increments('id').primary();
      t.string('origin').nullable();
    });
    await db.schema.createTable('sessions', (t) => {
      t.increments('id').primary();
      t.integer('repo_id').nullable();
      t.boolean('auto_push').notNullable().defaultTo(true);
    });
    await db('repos').insert([
      { id: 1, origin: 'https://github.com/acme/app.git' },
      { id: 2, origin: null },
    ]);
    await db('sessions').insert([
      { repo_id: 1, auto_push: true },
      { repo_id: 2, auto_push: true },
      { repo_id: 2, auto_push: false },
    ]);
    await up(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('sets auto_push false only for sessions on local repos', async () => {
    const rows = await db('sessions').select('repo_id', 'auto_push').orderBy('id');
    expect(rows).toEqual([
      { repo_id: 1, auto_push: 1 },
      { repo_id: 2, auto_push: 0 },
      { repo_id: 2, auto_push: 0 },
    ]);
  });
});
