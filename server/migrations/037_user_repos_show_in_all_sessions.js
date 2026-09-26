export async function up(knex) {
  await knex.raw(
    'ALTER TABLE user_repos ADD COLUMN show_in_all_sessions INTEGER NOT NULL DEFAULT 1'
  );
}

export async function down(knex) {
  await knex.raw('ALTER TABLE user_repos DROP COLUMN show_in_all_sessions');
}
