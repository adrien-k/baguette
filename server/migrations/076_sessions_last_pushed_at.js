export async function up(knex) {
  await knex.schema.alterTable('sessions', (t) => {
    t.timestamp('last_pushed_at');
    t.timestamp('pr_metadata_updated_at');
  });
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN last_pushed_at');
  await knex.raw('ALTER TABLE sessions DROP COLUMN pr_metadata_updated_at');
}
