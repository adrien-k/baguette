/**
 * Remembers whether a loop was created from an existing session (Send regularly)
 * rather than later spawning a session of its own. ADD COLUMN is native SQLite DDL.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('loops', 'created_from_session'))) {
    await knex.schema.table('loops', (t) => {
      t.boolean('created_from_session').notNullable().defaultTo(false);
    });
  }
  // Existing pins: session existed before the loop → created from that session.
  await knex.raw(`
    UPDATE loops SET created_from_session = 1
    WHERE session_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM sessions
        WHERE sessions.id = loops.session_id
          AND sessions.created_at < loops.created_at
      )
  `);
}

export async function down(knex) {
  if (await knex.schema.hasColumn('loops', 'created_from_session')) {
    await knex.raw('ALTER TABLE loops DROP COLUMN created_from_session');
  }
}
