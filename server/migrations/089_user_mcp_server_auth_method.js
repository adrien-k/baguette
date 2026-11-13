/**
 * Persisted auth-method choice for outbound MCP servers ('none' | 'bearer' |
 * 'oauth'), picked in Settings → Integrations and honoring the availability
 * probe (smart connect when dynamic registration is available, otherwise
 * manual client registration).
 *
 * Raw DDL only: `mcp_oauth_states` holds a foreign key to `user_mcp_servers`,
 * so schema-builder calls that route through Knex's SQLite table rebuild
 * (`ALTER` variants beyond ADD/DROP COLUMN) would fail on the FK.
 */
export async function up(knex) {
  if (await knex.schema.hasColumn('user_mcp_servers', 'auth_method')) return;
  await knex.raw('ALTER TABLE user_mcp_servers ADD COLUMN auth_method TEXT');
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('user_mcp_servers', 'auth_method'))) return;
  await knex.raw('ALTER TABLE user_mcp_servers DROP COLUMN auth_method');
}
