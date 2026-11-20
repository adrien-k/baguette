/** Labels of skills to inject into the builder system prompt (JSON string array). */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'auto_load_skills'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN auto_load_skills TEXT');
  }
  if (!(await knex.schema.hasColumn('loops', 'auto_load_skills'))) {
    await knex.raw('ALTER TABLE loops ADD COLUMN auto_load_skills TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('loops', 'auto_load_skills')) {
    await knex.raw('ALTER TABLE loops DROP COLUMN auto_load_skills');
  }
  if (await knex.schema.hasColumn('sessions', 'auto_load_skills')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN auto_load_skills');
  }
}
