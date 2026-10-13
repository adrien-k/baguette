export async function up(knex) {
  if (await knex.schema.hasColumn('sessions', 'last_reviewed_commit_sha')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN last_reviewed_commit_sha');
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'last_reviewed_commit_sha'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN last_reviewed_commit_sha TEXT');
  }
}
