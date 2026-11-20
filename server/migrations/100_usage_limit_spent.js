/**
 * Paid-credit spend a session has already used under `usage_limit_action = continue`, so the
 * session's `usage_limit` caps the whole session rather than each turn.
 *
 * Plain ADD COLUMN — no table rebuild (SQLite 3.35+).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'usage_limit_spent'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN usage_limit_spent REAL NOT NULL DEFAULT 0');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('sessions', 'usage_limit_spent')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN usage_limit_spent');
  }
}
