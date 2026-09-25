export async function up(knex) {
  await knex.raw("ALTER TABLE users ADD COLUMN color_scheme TEXT NOT NULL DEFAULT 'dark'");
}

export async function down(knex) {
  await knex.raw('ALTER TABLE users DROP COLUMN color_scheme');
}
