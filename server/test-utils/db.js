/**
 * Shared test database: in-memory SQLite with migrations applied.
 * Use for integration-style tests that need a real DB (e.g. tasks service scoping).
 */
import Knex from 'knex';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeAll, beforeEach, afterAll } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsPath = path.join(__dirname, '../migrations');

const TABLES_SKIP_TRUNCATE = new Set([
  'sqlite_sequence',
  'knex_migrations',
  'knex_migrations_lock',
]);

/** Default agent identity on sessions / messages rows in tests (matches messages.create requirements). */
export const testSessionAgentDefaults = {
  agent_sdk: 'claude',
  model: 'sonnet',
};

const testMessageIdentityDefaults = {
  ...testSessionAgentDefaults,
};

const AGENT_FIELDS_ON_SESSION = new Set([
  'agent_sdk',
  'model',
  'agent_config_id',
  'model_params',
  'claude_session_id',
  'cursor_agent_id',
  'pi_session_id',
  'review_agent_config_id',
  'review_agent_sdk',
  'review_model',
  'review_model_params',
  'review_claude_session_id',
  'review_cursor_agent_id',
  'review_pi_session_id',
  'review_status',
  'review_initial_prompt',
  'active_chat_turn_id',
  'active_review_turn_id',
  'current_turn_id',
  'agent_type',
]);

/**
 * Insert a session row and its primary builder agent (post-migration 061).
 * Agent identity fields are stripped from the sessions insert and stored on `agents`.
 */
export async function insertTestSession(db, sessionFields = {}) {
  const { insertSessionWithPrimaryBuilder } = await import('./session-agents.js');
  const merged = { status: 'stopped', ...testSessionAgentDefaults, ...sessionFields };
  const agentPatch = {};
  const sessionOnly = {};
  for (const [key, value] of Object.entries(merged)) {
    if (AGENT_FIELDS_ON_SESSION.has(key)) {
      if (key.startsWith('review_')) {
        if (key === 'review_agent_config_id') agentPatch.agent_config_id = value;
        else if (key === 'review_agent_sdk') agentPatch.agent_sdk = value;
        else if (key === 'review_model') agentPatch.model = value;
        else if (key === 'review_model_params') agentPatch.model_params = value;
      } else if (key !== 'agent_type' && key !== 'review_status') {
        agentPatch[key] = value;
      }
    } else {
      sessionOnly[key] = value;
    }
  }
  return insertSessionWithPrimaryBuilder(db, { ...sessionOnly, ...agentPatch });
}

export async function getPrimaryBuilderAgentId(db, sessionId) {
  const row = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
  return row?.id ?? null;
}

/** Message insert fields including `agent_id` for the session primary builder. */
export async function testMessageRow(db, sessionId, fields = {}) {
  const agentId = await getPrimaryBuilderAgentId(db, sessionId);
  return {
    session_id: sessionId,
    agent_id: agentId,
    ...testMessageIdentityDefaults,
    ...fields,
  };
}

async function createAndMigrate() {
  const db = Knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: { directory: migrationsPath },
  });
  await db.migrate.latest();
  return db;
}

async function truncateAllTables(db) {
  await db.raw('PRAGMA foreign_keys = OFF');
  const tables = await db
    .select('name')
    .from('sqlite_master')
    .where('type', 'table')
    .whereNotIn('name', [...TABLES_SKIP_TRUNCATE]);
  for (const { name } of tables) {
    await db(name).del();
  }
  // Reset AUTOINCREMENT so the next insert in each table starts at 1 again.
  await db('sqlite_sequence').del();
  await db.raw('PRAGMA foreign_keys = ON');
}

/**
 * Wire an in-memory test DB to Vitest lifecycle hooks in the current suite.
 * - beforeAll: create DB and run migrations once
 * - beforeEach: delete all rows (fast reset between tests)
 * - afterAll: destroy the DB
 *
 * @returns {import('knex').Knex} Knex query builder bound to the suite DB
 */
export function createTestDb() {
  let dbRef = null;

  beforeAll(async () => {
    dbRef = await createAndMigrate();
  });

  beforeEach(async () => {
    await truncateAllTables(dbRef);
  });

  afterAll(async () => {
    await dbRef?.destroy();
  });

  const db = (table) => dbRef(table);
  // Knex exposes helpers on the instance itself (db.raw, db.fn); mirror the ones
  // production code uses so a mocked `db` behaves like the real one.
  db.raw = (...args) => dbRef.raw(...args);
  db.fn = { now: (...args) => dbRef.fn.now(...args) };
  db.transaction = (...args) => dbRef.transaction(...args);
  return db;
}
