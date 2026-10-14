/**
 * Replace `usage.kind` with `usage.agent_type` (`builder` | `reviewer`).
 * Native SQLite ADD/DROP COLUMN — no table rebuild (see AGENTS.md).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('usage', 'agent_type'))) {
    await knex.raw('ALTER TABLE usage ADD COLUMN agent_type TEXT');
  }

  await knex.raw(`
    UPDATE usage
    SET agent_type = (
      SELECT agent_type FROM agents WHERE agents.id = usage.agent_id
    )
    WHERE agent_id IS NOT NULL AND (agent_type IS NULL OR agent_type = '')
  `);

  await knex.raw(`
    UPDATE usage SET agent_type = 'reviewer'
    WHERE (agent_type IS NULL OR agent_type = '') AND kind = 'review'
  `);

  await knex.raw(`
    UPDATE usage SET agent_type = 'builder'
    WHERE agent_type IS NULL OR agent_type = ''
  `);

  if (await knex.schema.hasColumn('usage', 'kind')) {
    await knex.raw('ALTER TABLE usage DROP COLUMN kind');
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('usage', 'kind'))) {
    await knex.raw('ALTER TABLE usage ADD COLUMN kind TEXT');
  }
  await knex.raw(`
    UPDATE usage SET kind = CASE WHEN agent_type = 'reviewer' THEN 'review' ELSE NULL END
  `);
  if (await knex.schema.hasColumn('usage', 'agent_type')) {
    await knex.raw('ALTER TABLE usage DROP COLUMN agent_type');
  }
}
