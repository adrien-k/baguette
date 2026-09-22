/**
 * Shared test database: in-memory SQLite with migrations applied.
 * Use for integration-style tests that need a real DB (e.g. tasks service scoping).
 */
import Knex from 'knex';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsPath = path.join(__dirname, '../migrations');

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

/**
 * Wire an in-memory test DB to Vitest lifecycle hooks.
 * - beforeAll: create DB and run migrations
 * - afterEach: clear all table data
 * - afterAll: destroy the DB
 *
 * @param {() => void | Promise<void>} beforeAllFn - Vitest beforeAll
 * @param {() => void | Promise<void>} afterAllFn - Vitest afterAll
 * @param {() => void | Promise<void>} afterEachFn - Vitest afterEach
 * @returns {{ get db(): import('knex').Knex | null }} Getter for the DB (valid after beforeAll has run)
 */
export function createTestDb({ beforeEach, afterEach }) {
  let dbRef = null;

  beforeEach(async () => {
    dbRef = await createAndMigrate();
  });

  afterEach(async () => {
    await dbRef.destroy();
  });

  const db = (table) => dbRef(table);
  // Knex exposes helpers on the instance itself (db.raw, db.fn); mirror the ones
  // production code uses so a mocked `db` behaves like the real one.
  db.raw = (...args) => dbRef.raw(...args);
  db.fn = { now: (...args) => dbRef.fn.now(...args) };
  db.transaction = (...args) => dbRef.transaction(...args);
  return db;
}
