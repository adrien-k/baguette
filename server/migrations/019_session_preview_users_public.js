export async function up(knex) {
  await knex.schema.alterTable('sessions', (t) => {
    t.boolean('is_preview_users_public').notNullable().defaultTo(1);
  });
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN is_preview_users_public');
}
