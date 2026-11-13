/**
 * Link subagents started via StartSubagent to the parent agent that spawned them.
 */

export async function up(knex) {
  if (!(await knex.schema.hasColumn('agents', 'parent_agent_id'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN parent_agent_id INTEGER REFERENCES agents(id)');
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS agents_parent_agent_id_idx ON agents (parent_agent_id)'
    );
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('agents', 'parent_agent_id')) {
    await knex.raw('DROP INDEX IF EXISTS agents_parent_agent_id_idx');
    await knex.raw('ALTER TABLE agents DROP COLUMN parent_agent_id');
  }
}
