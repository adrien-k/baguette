/**
 * Instance-wide sharing for sessions/loops, per-message authors, and per-viewer
 * last-viewed state. Native ADD COLUMN only — never rebuild `sessions` / `users`.
 */

export async function up(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'is_shared'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await knex.schema.hasColumn('loops', 'is_shared'))) {
    await knex.raw('ALTER TABLE loops ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await knex.schema.hasColumn('session_messages', 'author_user_id'))) {
    await knex.raw('ALTER TABLE session_messages ADD COLUMN author_user_id INTEGER');
  }

  if (!(await knex.schema.hasTable('session_user_state'))) {
    await knex.schema.createTable('session_user_state', (t) => {
      t.integer('session_id').notNullable();
      t.integer('user_id').notNullable().references('id').inTable('users');
      t.timestamp('last_viewed_at').nullable();
      t.primary(['session_id', 'user_id']);
    });
  }

  await knex.raw('CREATE INDEX IF NOT EXISTS sessions_is_shared_idx ON sessions (is_shared)');
  await knex.raw('CREATE INDEX IF NOT EXISTS loops_is_shared_idx ON loops (is_shared)');
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS session_messages_author_user_id_idx ON session_messages (author_user_id)'
  );

  await knex.raw(`
    UPDATE session_messages
    SET author_user_id = (
      SELECT sessions.user_id FROM sessions WHERE sessions.id = session_messages.session_id
    )
    WHERE type = 'user' AND author_user_id IS NULL
  `);

  await knex.raw(`
    INSERT OR IGNORE INTO session_user_state (session_id, user_id, last_viewed_at)
    SELECT id, user_id, last_viewed_at FROM sessions
    WHERE last_viewed_at IS NOT NULL
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('session_user_state');
  await knex.raw('DROP INDEX IF EXISTS sessions_is_shared_idx');
  await knex.raw('DROP INDEX IF EXISTS loops_is_shared_idx');
  await knex.raw('DROP INDEX IF EXISTS session_messages_author_user_id_idx');
  if (await knex.schema.hasColumn('session_messages', 'author_user_id')) {
    await knex.raw('ALTER TABLE session_messages DROP COLUMN author_user_id');
  }
  if (await knex.schema.hasColumn('sessions', 'is_shared')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN is_shared');
  }
  if (await knex.schema.hasColumn('loops', 'is_shared')) {
    await knex.raw('ALTER TABLE loops DROP COLUMN is_shared');
  }
}
