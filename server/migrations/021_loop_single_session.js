export async function up(knex) {
  await knex.schema.alterTable('loops', (t) => {
    // When set, every run continues in `session_id` instead of starting a fresh session.
    t.boolean('single_session').notNullable().defaultTo(false);
    // No FK, for the same reason as `last_session_id`: a session row can be hard-removed.
    t.integer('session_id');
  });
}

export async function down(knex) {
  // Native DROP COLUMN — Knex's SQLite rebuild path would drop and recreate `loops`.
  await knex.raw('ALTER TABLE loops DROP COLUMN single_session');
  await knex.raw('ALTER TABLE loops DROP COLUMN session_id');
}
