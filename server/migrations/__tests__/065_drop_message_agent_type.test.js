import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';

describe('065_drop_message_agent_type', () => {
  let knex;
  let builder1Id;
  let reviewer1Id;
  let builder2Id;
  const sessionWithReviewer = 1;
  const sessionBuilderOnly = 2;

  beforeEach(async () => {
    knex = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await knex.schema.createTable('sessions', (t) => {
      t.increments('id').primary();
    });
    await knex('sessions').insert([{ id: sessionWithReviewer }, { id: sessionBuilderOnly }]);

    await knex.schema.createTable('agents', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
      t.string('agent_type').notNullable();
      t.integer('is_primary').notNullable().defaultTo(0);
    });
    [builder1Id] = await knex('agents').insert({
      session_id: sessionWithReviewer,
      agent_type: 'builder',
      is_primary: 1,
    });
    [reviewer1Id] = await knex('agents').insert({
      session_id: sessionWithReviewer,
      agent_type: 'reviewer',
      is_primary: 0,
    });
    [builder2Id] = await knex('agents').insert({
      session_id: sessionBuilderOnly,
      agent_type: 'builder',
      is_primary: 1,
    });

    await knex.schema.createTable('session_messages', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
      t.string('type').notNullable();
      t.text('message_json').notNullable();
      t.string('agent_type');
      t.integer('agent_id');
    });
    await knex.schema.createTable('queued_messages', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
      t.text('message_json').notNullable();
      t.string('agent_type');
      t.integer('agent_id');
    });

    await knex('session_messages').insert([
      {
        session_id: sessionWithReviewer,
        type: 'user',
        message_json: '{}',
        agent_type: 'builder',
        agent_id: null,
      },
      {
        session_id: sessionWithReviewer,
        type: 'user',
        message_json: '{}',
        agent_type: 'reviewer',
        agent_id: null,
      },
      {
        session_id: sessionWithReviewer,
        type: 'assistant',
        message_json: '{}',
        agent_type: 'reviewer',
        agent_id: reviewer1Id,
      },
      {
        session_id: sessionBuilderOnly,
        type: 'user',
        message_json: '{}',
        agent_type: 'builder',
        agent_id: null,
      },
    ]);

    await knex('queued_messages').insert([
      {
        session_id: sessionWithReviewer,
        message_json: '{}',
        agent_type: 'builder',
        agent_id: null,
      },
      {
        session_id: sessionWithReviewer,
        message_json: '{}',
        agent_type: 'reviewer',
        agent_id: null,
      },
      {
        session_id: sessionWithReviewer,
        message_json: '{}',
        agent_type: null,
        agent_id: null,
      },
      {
        session_id: sessionBuilderOnly,
        message_json: '{}',
        agent_type: 'builder',
        agent_id: null,
      },
    ]);
  });

  afterEach(async () => {
    await knex.destroy();
  });

  it('backfills agent_id, drops agent_type, and down() restores columns', async () => {
    const mod = await import('../065_drop_message_agent_type.js');
    await mod.up(knex);

    expect(await knex.schema.hasColumn('session_messages', 'agent_type')).toBe(false);
    expect(await knex.schema.hasColumn('queued_messages', 'agent_type')).toBe(false);

    const msgs = await knex('session_messages').orderBy('id');
    expect(msgs[0].agent_id).toBe(builder1Id);
    expect(msgs[1].agent_id).toBe(reviewer1Id);
    expect(msgs[2].agent_id).toBe(reviewer1Id);
    expect(msgs[3].agent_id).toBe(builder2Id);

    const queued = await knex('queued_messages').orderBy('id');
    expect(queued[0].agent_id).toBe(builder1Id);
    expect(queued[1].agent_id).toBe(reviewer1Id);
    expect(queued[2].agent_id).toBe(builder1Id);
    expect(queued[3].agent_id).toBe(builder2Id);

    await mod.down(knex);

    expect(await knex.schema.hasColumn('session_messages', 'agent_type')).toBe(true);
    expect(await knex.schema.hasColumn('queued_messages', 'agent_type')).toBe(true);

    const msgsAfterDown = await knex('session_messages').orderBy('id');
    expect(msgsAfterDown.map((r) => r.agent_type)).toEqual([
      'builder',
      'reviewer',
      'reviewer',
      'builder',
    ]);

    const queuedAfterDown = await knex('queued_messages').orderBy('id');
    expect(queuedAfterDown.map((r) => r.agent_type)).toEqual([
      'builder',
      'reviewer',
      'builder',
      'builder',
    ]);
  });
});
