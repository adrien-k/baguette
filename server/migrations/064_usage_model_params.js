/**
 * Snapshot model_params on usage rows so pricing survives agent deletion.
 * Native SQLite ADD COLUMN — no table rebuild (see AGENTS.md).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('usage', 'model_params'))) {
    await knex.raw('ALTER TABLE usage ADD COLUMN model_params TEXT');
  }

  await knex.raw(`
    UPDATE usage
    SET model_params = (
      SELECT model_params FROM agents WHERE agents.id = usage.agent_id
    )
    WHERE agent_id IS NOT NULL AND (model_params IS NULL OR model_params = '')
  `);
}

export async function down(knex) {
  if (await knex.schema.hasColumn('usage', 'model_params')) {
    await knex.raw('ALTER TABLE usage DROP COLUMN model_params');
  }
}
