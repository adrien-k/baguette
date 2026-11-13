/**
 * Per-user outbound MCP servers (HTTP/SSE), OAuth PKCE state, and the
 * session/loop enable snapshot columns.
 */
export async function up(knex) {
  const hasServers = await knex.schema.hasTable('user_mcp_servers');
  if (!hasServers) {
    await knex.schema.createTable('user_mcp_servers', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('name').notNullable();
      t.string('transport').notNullable();
      t.text('url').notNullable();
      t.boolean('enabled').notNullable().defaultTo(true);
      t.text('bearer_token_encrypted').nullable();
      t.text('headers_encrypted').nullable();
      t.text('oauth_client_id_encrypted').nullable();
      t.text('oauth_client_secret_encrypted').nullable();
      t.text('oauth_client_information_encrypted').nullable();
      t.text('oauth_tokens_encrypted').nullable();
      t.text('oauth_scope').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.unique(['user_id', 'name']);
      t.index(['user_id']);
    });
  }

  const hasStates = await knex.schema.hasTable('mcp_oauth_states');
  if (!hasStates) {
    await knex.schema.createTable('mcp_oauth_states', (t) => {
      t.string('state').primary();
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.integer('mcp_server_id')
        .notNullable()
        .references('id')
        .inTable('user_mcp_servers')
        .onDelete('CASCADE');
      t.text('code_verifier').notNullable();
      t.timestamp('expires_at').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasColumn('sessions', 'mcp_servers'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN mcp_servers TEXT');
  }
  if (!(await knex.schema.hasColumn('loops', 'mcp_servers'))) {
    await knex.raw('ALTER TABLE loops ADD COLUMN mcp_servers TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('loops', 'mcp_servers')) {
    await knex.raw('ALTER TABLE loops DROP COLUMN mcp_servers');
  }
  if (await knex.schema.hasColumn('sessions', 'mcp_servers')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN mcp_servers');
  }
  await knex.schema.dropTableIfExists('mcp_oauth_states');
  await knex.schema.dropTableIfExists('user_mcp_servers');
}
