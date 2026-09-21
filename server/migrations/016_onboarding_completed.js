export async function up(knex) {
  await knex.raw('ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0');
  // Existing users don't need to go through onboarding
  await knex('users').update({ onboarding_completed: 1 });
}

export async function down(knex) {
  await knex.raw('ALTER TABLE users DROP COLUMN onboarding_completed');
}
