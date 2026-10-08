import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { up, down } from '../053_repos_origin.js';

describe('053_repos_origin', () => {
  let db;

  beforeEach(async () => {
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('repos', (t) => {
      t.increments('id').primary();
      t.string('full_name').notNullable();
      t.string('repo_path').notNullable();
    });
    await db('repos').insert([
      { full_name: 'acme/app', repo_path: 'repos/acme-app/main' },
      { full_name: 'scratch', repo_path: 'repos/scratch/main' },
      { full_name: '/tmp/imported', repo_path: 'repos/imported/main' },
    ]);
    await up(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('backfills GitHub origin from full_name and leaves local repos null', async () => {
    const rows = await db('repos').select('full_name', 'origin').orderBy('id');
    expect(rows).toEqual([
      { full_name: 'acme/app', origin: 'https://github.com/acme/app.git' },
      { full_name: 'scratch', origin: null },
      { full_name: '/tmp/imported', origin: null },
    ]);
  });

  it('drops origin on down', async () => {
    await down(db);
    const row = await db('repos').where({ full_name: 'acme/app' }).first();
    expect(row.origin).toBeUndefined();
  });
});
