/**
 * Per-server guidance text ("when and why agents should use this server"),
 * written in Settings → Integrations and injected into the session system
 * prompt (and Pi's per-session `mcp.json`).
 *
 * Raw DDL only: `mcp_oauth_states` holds a foreign key to `user_mcp_servers`,
 * so schema-builder calls that route through Knex's SQLite table rebuild
 * (`ALTER` variants beyond ADD/DROP COLUMN) would fail on the FK.
 */
export async function up(knex) {
  if (await knex.schema.hasColumn('user_mcp_servers', 'description')) return;
  await knex.raw('ALTER TABLE user_mcp_servers ADD COLUMN description TEXT');
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('user_mcp_servers', 'description'))) return;
  await knex.raw('ALTER TABLE user_mcp_servers DROP COLUMN description');
}
