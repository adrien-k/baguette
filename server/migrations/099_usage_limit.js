/**
 * Usage-limit policy on sessions and loops.
 *
 * usage_limit_action — what the agent does at a subscription limit:
 *                      stop (default) | wait (until the reset, then continue) |
 *                      continue (keep going on paid credits)
 * usage_limit        — USD of paid credits the session may spend under `continue`
 *                      (NULL = unlimited; may be below a dollar)
 *
 * Plain ADD COLUMN — no table rebuild (SQLite 3.35+).
 */
const TABLES = ['sessions', 'loops'];

export async function up(knex) {
  for (const table of TABLES) {
    if (!(await knex.schema.hasColumn(table, 'usage_limit_action'))) {
      await knex.raw(
        `ALTER TABLE ${table} ADD COLUMN usage_limit_action TEXT NOT NULL DEFAULT 'stop'`
      );
    }
    if (!(await knex.schema.hasColumn(table, 'usage_limit'))) {
      await knex.raw(`ALTER TABLE ${table} ADD COLUMN usage_limit REAL`);
    }
  }
}

export async function down(knex) {
  for (const table of TABLES) {
    for (const column of ['usage_limit', 'usage_limit_action']) {
      if (await knex.schema.hasColumn(table, column)) {
        await knex.raw(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      }
    }
  }
}
