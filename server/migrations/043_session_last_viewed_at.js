export async function up(knex) {
  await knex.schema.alterTable('sessions', (t) => {
    t.timestamp('last_viewed_at');
  });
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN last_viewed_at');
}
