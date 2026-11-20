/**
 * Slack assistant: one long-lived global session per Baguette user and Slack app, instead of one
 * session per Slack thread.
 *
 * - sessions.slack_app_id types a session as a Slack assistant (null for every other session). At
 *   most one live assistant exists per user and app.
 * - slack_session_threads lists the threads an assistant serves, so untagged follow-ups reach it.
 * - slack_session_allowed_users is the owner's allow-list: Slack users the assistant listens to
 *   besides its owner. Everyone else is ignored.
 * - slack_apps.allowed_repo_ids (JSON array of repo ids; null = all) limits the repositories an
 *   assistant may start sessions in.
 *
 * Replaces the per-thread bindings and approval state added in 077. Native DDL only — never
 * rebuild `sessions` (see AGENTS.md).
 */
export async function up(knex) {
  await knex.schema.dropTableIfExists('slack_threads');
  await knex.raw('ALTER TABLE sessions DROP COLUMN slack_approvals');
  await knex.raw('ALTER TABLE sessions DROP COLUMN slack_owner');

  await knex.raw('ALTER TABLE sessions ADD COLUMN slack_app_id INTEGER');
  await knex.raw(
    `CREATE UNIQUE INDEX sessions_slack_assistant_idx ON sessions (user_id, slack_app_id)
     WHERE slack_app_id IS NOT NULL AND archived_at IS NULL`
  );
  await knex.raw('ALTER TABLE slack_apps ADD COLUMN allowed_repo_ids TEXT');

  await knex.schema.createTable('slack_session_threads', (t) => {
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.string('channel_id').notNullable();
    t.string('thread_ts').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.primary(['session_id', 'channel_id', 'thread_ts']);
    t.index(['channel_id', 'thread_ts']);
  });

  await knex.schema.createTable('slack_session_allowed_users', (t) => {
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.string('slack_user_id').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.primary(['session_id', 'slack_user_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTable('slack_session_allowed_users');
  await knex.schema.dropTable('slack_session_threads');

  await knex.raw('ALTER TABLE slack_apps DROP COLUMN allowed_repo_ids');
  await knex.raw('DROP INDEX sessions_slack_assistant_idx');
  await knex.raw('ALTER TABLE sessions DROP COLUMN slack_app_id');

  await knex.raw('ALTER TABLE sessions ADD COLUMN slack_owner TEXT');
  await knex.raw('ALTER TABLE sessions ADD COLUMN slack_approvals TEXT');
  await knex.schema.createTable('slack_threads', (t) => {
    t.increments('id').primary();
    t.integer('slack_app_id').references('id').inTable('slack_apps').notNullable();
    t.string('channel_id').notNullable();
    t.string('thread_ts').notNullable();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.integer('last_posted_message_id').notNullable().defaultTo(0);
    t.string('status_ts');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['slack_app_id', 'channel_id', 'thread_ts', 'session_id']);
    t.index(['slack_app_id', 'channel_id', 'thread_ts']);
    t.index(['session_id']);
  });
}
