/** If migrate fails with a missing `039_session_review_started_commit.js`, run `pnpm run repair-migrations-039` first. */
export async function up(knex) {
  await knex.raw('ALTER TABLE sessions ADD COLUMN last_reviewed_commit_sha TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN last_reviewed_commit_sha');
}
