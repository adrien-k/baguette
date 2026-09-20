const DEFAULT_PREFS = JSON.stringify({
  cursor_fast: 'default',
  cursor_effort: 'default',
});

export async function up(knex) {
  await knex.raw('ALTER TABLE users ADD COLUMN agent_preferences TEXT');
  await knex('users').update({ agent_preferences: DEFAULT_PREFS });
}

export async function down(knex) {
  await knex.raw('ALTER TABLE users DROP COLUMN agent_preferences');
}
