/** Skill labels to pre-select on new sessions and loops (Settings → Skills). */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'default_auto_load_skills'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN default_auto_load_skills TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('users', 'default_auto_load_skills')) {
    await knex.raw('ALTER TABLE users DROP COLUMN default_auto_load_skills');
  }
}
