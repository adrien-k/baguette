/**
 * Instance-wide settings singleton (GitHub App credentials for optional GitHub).
 * id is pinned to 1 via CHECK; no row is inserted here — boot init creates it
 * (empty, or seeded from legacy AUTH_GITHUB_* env on first boot).
 */
export async function up(knex) {
  if (await knex.schema.hasTable('instance_settings')) return;
  await knex.raw(`
    CREATE TABLE instance_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      github_app_id INTEGER,
      github_app_slug TEXT,
      github_app_client_id TEXT,
      github_app_client_secret_encrypted TEXT,
      github_app_private_key_encrypted TEXT,
      github_app_webhook_secret_encrypted TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('instance_settings');
}
