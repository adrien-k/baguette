/**
 * MCP StartBuilderAgent subagents (MCP-driven extra builders).
 * Uses native SQLite ADD COLUMN (see CLAUDE.md).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('agents', 'subagent'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN subagent INTEGER NOT NULL DEFAULT 0');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('agents', 'subagent')) {
    await knex.raw('ALTER TABLE agents DROP COLUMN subagent');
  }
}
