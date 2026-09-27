export async function up(knex) {
  await knex.schema.alterTable('sessions', (t) => {
    t.timestamp('last_activity_at');
  });
  await knex.raw('UPDATE sessions SET last_activity_at = created_at');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN last_activity_at');
}
