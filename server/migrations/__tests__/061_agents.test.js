import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { up } from '../061_agents.js';

describe('061_agents', () => {
  let db;

  beforeEach(async () => {
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('agent_configs', (t) => {
      t.increments('id').primary();
    });
    await db('agent_configs').insert({ id: 1 });
    await db.schema.createTable('sessions', (t) => {
      t.increments('id').primary();
      t.integer('agent_config_id');
      t.string('agent_sdk');
      t.text('model');
      t.text('model_params');
      t.string('status').defaultTo('stopped');
      t.string('review_status');
      t.integer('active_chat_turn_id');
      t.integer('active_review_turn_id');
      t.string('review_agent_config_id');
      t.string('review_agent_sdk');
      t.text('review_model');
    });
    await db.schema.createTable('session_messages', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
      t.string('type').notNullable();
      t.text('message_json').notNullable();
      t.string('agent_type').defaultTo('builder');
      t.integer('turn_id');
      t.string('tool_call_id');
    });
    await db.schema.createTable('queued_messages', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
      t.text('message_json').notNullable();
      t.string('agent_type').defaultTo('builder');
    });
    await db.schema.createTable('usage', (t) => {
      t.increments('id').primary();
      t.integer('session_id').notNullable();
      t.string('kind');
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('creates builder and reviewer agents and backfills agent_id on messages', async () => {
    const [sessionId] = await db('sessions').insert({
      agent_config_id: 1,
      agent_sdk: 'claude',
      model: 'sonnet',
      status: 'running',
      review_status: 'stopped',
    });
    await db('session_messages').insert([
      {
        session_id: sessionId,
        type: 'user',
        message_json: '{}',
        agent_type: 'builder',
        turn_id: 2,
      },
      {
        session_id: sessionId,
        type: 'user',
        message_json: '{}',
        agent_type: 'reviewer',
        turn_id: 1,
      },
    ]);

    await up(db);

    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    const reviewer = await db('agents')
      .where({ session_id: sessionId, agent_type: 'reviewer' })
      .first();
    expect(builder).toBeTruthy();
    expect(reviewer).toBeTruthy();
    expect(builder.status).toBe('running');
    expect(builder.current_turn_id).toBe(2);

    const msgs = await db('session_messages').where({ session_id: sessionId });
    expect(msgs.find((m) => m.agent_type === 'builder').agent_id).toBe(builder.id);
    expect(msgs.find((m) => m.agent_type === 'reviewer').agent_id).toBe(reviewer.id);

    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.status).toBe('stopped');
    expect(session.agent_config_id).toBeUndefined();
  });
});
