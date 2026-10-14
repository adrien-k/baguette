/**
 * SQLite: use native ADD COLUMN (no table rebuild).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('session_todos', 'title'))) {
    await knex.raw('ALTER TABLE session_todos ADD COLUMN title TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('session_todos', 'title')) {
    await knex.raw('ALTER TABLE session_todos DROP COLUMN title');
  }
}
