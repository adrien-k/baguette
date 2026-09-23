export async function up(knex) {
  await knex.schema.alterTable('sessions', (t) => {
    // No FK: deleting a loop must not be blocked by (or cascade into) the sessions it produced,
    // and a foreign key here would stress any future rebuild of `loops` (see CLAUDE.md).
    t.integer('loop_id').nullable();
  });
}

export async function down(knex) {
  // Native DROP COLUMN — Knex's SQLite rebuild path would drop and recreate `sessions`,
  // which other tables reference.
  await knex.raw('ALTER TABLE sessions DROP COLUMN loop_id');
}
