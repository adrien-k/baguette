export async function up(knex) {
  await knex.raw('ALTER TABLE sessions ADD COLUMN review_initial_prompt TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN review_initial_prompt');
}
