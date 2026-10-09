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

export const testMessageIdentityDefaults = {
  agent_type: 'builder',
  ...testSessionAgentDefaults,
};

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
