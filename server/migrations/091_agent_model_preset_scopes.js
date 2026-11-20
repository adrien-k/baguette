/**
 * Per-preset on/off switch plus usage scopes: presets can be limited to
 * subagents (StartSubagent) and/or new sessions (CreateSession, loops).
 * Raw DDL only so the table is not rebuilt (Knex SQLite ALTER limitations);
 * defaults keep existing presets enabled and usable everywhere.
 */
export async function up(knex) {
  const columns = [
    {
      name: 'enabled',
      ddl: 'ALTER TABLE agent_model_presets ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1',
    },
    {
      name: 'for_subagents',
      ddl: 'ALTER TABLE agent_model_presets ADD COLUMN for_subagents INTEGER NOT NULL DEFAULT 1',
    },
    {
      name: 'for_new_sessions',
      ddl: 'ALTER TABLE agent_model_presets ADD COLUMN for_new_sessions INTEGER NOT NULL DEFAULT 1',
    },
  ];
  for (const { name, ddl } of columns) {
    if (await knex.schema.hasColumn('agent_model_presets', name)) continue;
    await knex.raw(ddl);
  }
}

export async function down(knex) {
  for (const name of ['enabled', 'for_subagents', 'for_new_sessions']) {
    if (!(await knex.schema.hasColumn('agent_model_presets', name))) continue;
    await knex.raw(`ALTER TABLE agent_model_presets DROP COLUMN ${name}`);
  }
}
