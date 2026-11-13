import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { down, up } from '../087_user_status.js';

// Canonical pre-087 users shape (001..086): only the approved boolean exists —
// users.revoked belonged to 079_user_revoked which never shipped and was deleted.
function makeKnex() {
  return Knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

describe('087_user_status', () => {
  let knexInstance;

  beforeEach(async () => {
    knexInstance = makeKnex();
    await knexInstance.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.string('username').notNullable();
      t.boolean('approved').defaultTo(false);
    });
    await knexInstance('users').insert([
      { id: 1, username: 'approved', approved: 1 },
      { id: 2, username: 'pending', approved: 0 },
    ]);
  });

  afterEach(async () => {
    await knexInstance.destroy();
  });

  it('backfills status from approved and drops the boolean column', async () => {
    await up(knexInstance);

    expect(await knexInstance.schema.hasColumn('users', 'approved')).toBe(false);

    const users = await knexInstance('users').orderBy('id');
    expect(users.map((u) => u.status)).toEqual(['approved', 'pending']);

    // New rows default to pending (NOT NULL DEFAULT 'pending').
    await knexInstance('users').insert({ username: 'fresh' });
    const [fresh] = await knexInstance('users').where({ username: 'fresh' });
    expect(fresh.status).toBe('pending');
  });

  it('enforces the status CHECK constraint', async () => {
    await up(knexInstance);

    await expect(
      knexInstance('users').insert({ username: 'bad', status: 'active' })
    ).rejects.toThrow();
    expect(await knexInstance('users').where({ username: 'bad' })).toHaveLength(0);
  });

  it('down() restores the approved boolean from status and drops status', async () => {
    await up(knexInstance);
    await down(knexInstance);

    expect(await knexInstance.schema.hasColumn('users', 'status')).toBe(false);
    expect(await knexInstance.schema.hasColumn('users', 'approved')).toBe(true);

    const users = await knexInstance('users').orderBy('id');
    expect(users.map((u) => u.approved)).toEqual([1, 0]);
  });

  it('up() is idempotent when run twice', async () => {
    await up(knexInstance);
    await up(knexInstance);

    const users = await knexInstance('users').orderBy('id');
    expect(users.map((u) => u.status)).toEqual(['approved', 'pending']);
  });

  it('up() works on a fresh table without legacy boolean columns', async () => {
    await knexInstance.schema.dropTable('users');
    await knexInstance.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.string('username').notNullable();
    });
    await knexInstance('users').insert({ username: 'fresh' });

    await up(knexInstance);

    expect(await knexInstance.schema.hasColumn('users', 'status')).toBe(true);
    const [user] = await knexInstance('users').where({ username: 'fresh' });
    expect(user.status).toBe('pending');
  });
});
