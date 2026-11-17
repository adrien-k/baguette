/**
 * Decision options on review issues.
 * Plain ADD COLUMN — no table rebuild (SQLite 3.35+).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('session_issues', 'options'))) {
    await knex.raw('ALTER TABLE session_issues ADD COLUMN options TEXT');
  }
  if (!(await knex.schema.hasColumn('session_issues', 'selected_option_id'))) {
    await knex.raw('ALTER TABLE session_issues ADD COLUMN selected_option_id TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('session_issues', 'selected_option_id')) {
    await knex.raw('ALTER TABLE session_issues DROP COLUMN selected_option_id');
  }
  if (await knex.schema.hasColumn('session_issues', 'options')) {
    await knex.raw('ALTER TABLE session_issues DROP COLUMN options');
  }
}
