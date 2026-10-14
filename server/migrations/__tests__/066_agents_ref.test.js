import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { up } from '../066_agents_ref.js';

describe('066_agents_ref', () => {
  let db;

  beforeEach(async () => {
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('sessions', (t) => {
      t.increments('id').primary();
    });
    await db.schema.createTable('agents', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
      t.string('name').notNullable();
      t.string('agent_type').notNullable();
      t.integer('is_primary').notNullable().defaultTo(0);
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('backfills session-relative refs in id order', async () => {
    const [sessionId] = await db('sessions').insert({});
    await db('agents').insert([
      { session_id: sessionId, name: 'Builder', agent_type: 'builder', is_primary: 1 },
      { session_id: sessionId, name: 'Reviewer', agent_type: 'reviewer', is_primary: 0 },
    ]);

    await up(db);

    const rows = await db('agents').where({ session_id: sessionId }).orderBy('id', 'asc');
    expect(rows.map((r) => r.ref)).toEqual([1, 2]);
  });

  it('continues ref sequence per session independently', async () => {
    const [s1] = await db('sessions').insert({});
    const [s2] = await db('sessions').insert({});
    await db('agents').insert([
      { session_id: s1, name: 'A', agent_type: 'builder', is_primary: 1 },
      { session_id: s2, name: 'B', agent_type: 'builder', is_primary: 1 },
      { session_id: s2, name: 'C', agent_type: 'reviewer', is_primary: 0 },
    ]);

    await up(db);

    const s1Rows = await db('agents').where({ session_id: s1 });
    const s2Rows = await db('agents').where({ session_id: s2 }).orderBy('id', 'asc');
    expect(s1Rows[0].ref).toBe(1);
    expect(s2Rows.map((r) => r.ref)).toEqual([1, 2]);
  });
});
