/**
 * Subagent default for MCP StartBuilderAgent (account-level on users).
 * Uses native SQLite ADD COLUMN (see CLAUDE.md).
 */
export async function up(knex) {
  const userCols = [
    'subagent_default_mode TEXT',
    'subagent_default_config_id INTEGER REFERENCES agent_configs(id)',
    'subagent_default_model TEXT',
  ];
  for (const col of userCols) {
    const name = col.split(' ')[0];
    if (!(await knex.schema.hasColumn('users', name))) {
      await knex.raw(`ALTER TABLE users ADD COLUMN ${col}`);
    }
  }
}

export async function down(knex) {
  for (const name of [
    'subagent_default_mode',
    'subagent_default_config_id',
    'subagent_default_model',
  ]) {
    if (await knex.schema.hasColumn('users', name)) {
      await knex.raw(`ALTER TABLE users DROP COLUMN ${name}`);
    }
  }
}
