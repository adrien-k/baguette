import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import Knex from 'knex';

const migrationsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = /^091_agent_observers/;

/** Fresh in-memory DB migrated up to the file immediately before 091. */
async function dbBeforeTarget() {
  const db = Knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: { directory: migrationsPath },
  });
  for (;;) {
    const [, pending] = await db.migrate.list();
    const next = pending[0]?.file ?? '';
    if (!next || TARGET.test(next)) break;
    await db.migrate.up();
  }
  return db;
}

describe('091 agent_observers', () => {
  let db;

  afterEach(async () => {
    await db?.destroy();
  });

  it('backfills subagent notify_parent rows and drops the flag column', async () => {
    db = await dbBeforeTarget();

    // Legacy pre-091 state: a session with a primary builder and a notify_parent subagent.
    const [userId] = await db('users').insert({ github_id: 1, username: 'u', status: 'approved' });
    const [sessionId] = await db('sessions').insert({
      user_id: userId,
      repo_full_name: 'o/r',
      base_branch: 'main',
      short_id: 'abc1',
      initial_prompt: 'work',
      status: 'stopped',
    });
    const [primaryId] = await db('agents').insert({
      session_id: sessionId,
      ref: 1,
      name: 'Builder',
      agent_type: 'builder',
      is_primary: 1,
      status: 'stopped',
      agent_config_id: null,
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
      notify_parent: 0,
    });
    const [watchedChildId] = await db('agents').insert({
      session_id: sessionId,
      ref: 2,
      name: 'Helper',
      agent_type: 'subagent',
      is_primary: 0,
      status: 'running',
      agent_config_id: null,
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
      parent_agent_id: primaryId,
      notify_parent: 1,
    });
    const [unwatchedChildId] = await db('agents').insert({
      session_id: sessionId,
      ref: 3,
      name: 'Quiet',
      agent_type: 'subagent',
      is_primary: 0,
      status: 'running',
      agent_config_id: null,
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
      parent_agent_id: primaryId,
      notify_parent: 0,
    });

    await db.migrate.latest();

    expect(await db.schema.hasColumn('agents', 'notify_parent')).toBe(false);
    expect(await db.schema.hasTable('agent_observers')).toBe(true);
    const rows = await db('agent_observers');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agent_id: watchedChildId,
      observer_agent_id: primaryId,
      notify_on: 'turn_end',
    });
    expect(unwatchedChildId).toBeTruthy();
  });

  it('restores the flag column on down', async () => {
    db = await dbBeforeTarget();
    const [userId] = await db('users').insert({ github_id: 2, username: 'u2', status: 'approved' });
    const [sessionId] = await db('sessions').insert({
      user_id: userId,
      repo_full_name: 'o/r',
      base_branch: 'main',
      short_id: 'abc2',
      initial_prompt: 'work',
      status: 'stopped',
    });
    const [primaryId] = await db('agents').insert({
      session_id: sessionId,
      ref: 1,
      name: 'Builder',
      agent_type: 'builder',
      is_primary: 1,
      status: 'stopped',
      agent_config_id: null,
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
    });

    await db.migrate.latest();
    await db('agent_observers').insert({
      agent_id: primaryId,
      observer_agent_id: primaryId,
      notify_on: 'turn_end',
    });
    // Cross-session observer pairs (different sessions) must not set the flag on down.
    const [otherSessionId] = await db('sessions').insert({
      user_id: userId,
      repo_full_name: 'o/r',
      base_branch: 'main',
      short_id: 'abc3',
      initial_prompt: 'work',
      status: 'stopped',
    });
    const [otherPrimaryId] = await db('agents').insert({
      session_id: otherSessionId,
      ref: 1,
      name: 'Watcher',
      agent_type: 'builder',
      is_primary: 1,
      status: 'stopped',
      agent_config_id: null,
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
    });
    await db('agent_observers').insert({
      agent_id: primaryId,
      observer_agent_id: otherPrimaryId,
      notify_on: 'turn_end',
    });

    // Target the 091 down explicitly — later migrations (092+) may exist and must stay.
    await db.migrate.down({ name: '091_agent_observers.js' });

    expect(await db.schema.hasColumn('agents', 'notify_parent')).toBe(true);
    expect(await db.schema.hasTable('agent_observers')).toBe(false);
    const primary = await db('agents').where({ id: primaryId }).first();
    expect(primary.notify_parent).toBe(1);
  });
});
