/**
 * Unify settings: personal secrets (user_id), drop unused user preference columns.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('secrets'))) return;

  const hasUserId = await knex.schema.hasColumn('secrets', 'user_id');
  if (!hasUserId) {
    await knex.raw(`
      CREATE TABLE secrets_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await knex.raw(`
      INSERT INTO secrets_new (id, key, value, user_id, created_at)
      SELECT id, key, value, NULL, created_at FROM secrets
    `);
    await knex.raw('DROP TABLE secrets');
    await knex.raw('ALTER TABLE secrets_new RENAME TO secrets');
    await knex.raw('CREATE UNIQUE INDEX secrets_key_scope ON secrets (key, COALESCE(user_id, -1))');
  }

  if (await knex.schema.hasColumn('users', 'default_agent_sdk')) {
    await knex.raw('ALTER TABLE users DROP COLUMN default_agent_sdk');
  }
  if (await knex.schema.hasColumn('users', 'allowed_commands')) {
    await knex.raw('ALTER TABLE users DROP COLUMN allowed_commands');
  }
  if (await knex.schema.hasColumn('users', 'builder_modal_mode')) {
    await knex.raw('ALTER TABLE users DROP COLUMN builder_modal_mode');
  }
  if (await knex.schema.hasColumn('users', 'reviewer_modal_mode')) {
    await knex.raw('ALTER TABLE users DROP COLUMN reviewer_modal_mode');
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('users', 'default_agent_sdk'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN default_agent_sdk TEXT');
  }
  if (!(await knex.schema.hasColumn('users', 'allowed_commands'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN allowed_commands TEXT');
  }
  if (!(await knex.schema.hasColumn('users', 'builder_modal_mode'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN builder_modal_mode INTEGER NOT NULL DEFAULT 1');
  }
  if (!(await knex.schema.hasColumn('users', 'reviewer_modal_mode'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN reviewer_modal_mode INTEGER NOT NULL DEFAULT 0');
  }

  if (!(await knex.schema.hasColumn('secrets', 'user_id'))) return;

  await knex.raw(`
    CREATE TABLE secrets_old (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await knex.raw(`
    INSERT INTO secrets_old (id, key, value, created_at)
    SELECT id, key, value, created_at FROM secrets WHERE user_id IS NULL
  `);
  await knex.raw('DROP TABLE secrets');
  await knex.raw('ALTER TABLE secrets_old RENAME TO secrets');
}
