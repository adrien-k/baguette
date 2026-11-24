import { describe, it, expect, afterEach } from 'vitest';
import knex from 'knex';
import { up, down } from '../103_users_owner.js';

describe('103_users_owner migration', () => {
  let db;

  afterEach(async () => {
    if (db) await db.destroy();
    db = null;
  });

  it('adds owner column, backfills first user as owner and admin, and enforces single owner', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.string('username').notNullable();
      t.integer('admin').notNullable().defaultTo(0);
    });
    const [firstId] = await db('users').insert({ username: 'first', admin: 0 });
    const [secondId] = await db('users').insert({ username: 'second', admin: 1 });

    await up(db);

    const first = await db('users').where({ id: firstId }).first();
    const second = await db('users').where({ id: secondId }).first();
    expect(first.owner).toBe(1);
    expect(first.admin).toBe(1);
    expect(second.owner).toBe(0);

    await expect(db('users').where({ id: secondId }).update({ owner: 1 })).rejects.toThrow();

    await down(db);
    expect(await db.schema.hasColumn('users', 'owner')).toBe(false);
  });
});
