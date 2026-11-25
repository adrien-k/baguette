/**
 * A Slack global session is now one per Slack thread (owned by the user whose message started it),
 * not one per Baguette user and Slack app. Drops the unique index 102 put on (user_id, slack_app_id);
 * "one live session per thread" is enforced by the Slack global sessions service, which looks the
 * thread up before creating.
 *
 * Native DDL only — never rebuild `sessions` (see AGENTS.md).
 */
export async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS sessions_slack_assistant_idx');
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS sessions_slack_app_idx ON sessions (slack_app_id, user_id)
     WHERE slack_app_id IS NOT NULL`
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS sessions_slack_app_idx');
  await knex.raw(
    `CREATE UNIQUE INDEX IF NOT EXISTS sessions_slack_assistant_idx ON sessions (user_id, slack_app_id)
     WHERE slack_app_id IS NOT NULL AND archived_at IS NULL`
  );
}
