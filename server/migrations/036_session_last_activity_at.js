export async function up(knex) {
  await knex.schema.alterTable('sessions', (t) => {
    t.timestamp('last_activity_at');
  });
  await knex.raw(`
    UPDATE sessions
    SET last_activity_at = COALESCE(
      (SELECT MAX(created_at) FROM session_messages WHERE session_id = sessions.id),
      created_at
    )
  `);
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN last_activity_at');
}
