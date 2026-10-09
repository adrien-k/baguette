/**
 * Attribute usage rows to the agent configuration used for the turn (chat vs review).
 */
export async function up(knex) {
  if (await knex.schema.hasColumn('usage', 'agent_config_id')) return;
  await knex.raw(
    'ALTER TABLE usage ADD COLUMN agent_config_id INTEGER REFERENCES agent_configs(id)'
  );

  await knex.raw(`
    UPDATE usage
    SET agent_config_id = (
      SELECT CASE
        WHEN usage.kind = 'review' THEN COALESCE(s.review_agent_config_id, s.agent_config_id)
        ELSE s.agent_config_id
      END
      FROM sessions AS s
      WHERE s.id = usage.session_id
    )
  `);
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('usage', 'agent_config_id'))) return;
  await knex.raw('ALTER TABLE usage DROP COLUMN agent_config_id');
}
