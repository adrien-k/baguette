/**
 * Inbound Slack: OAuth install, Socket Mode and the Events API.
 *
 * - slack_apps gains the app's credentials (app-level token, OAuth client, signing secret) and the
 *   identity learned at install time (Slack's app id, workspace, bot user), so events can be
 *   matched to a row and verified.
 * - slack_user_links ties a Slack user to the Baguette user whose account their sessions run as.
 * - slack_threads ties a Slack thread to the sessions that serve it. The newest row for a thread
 *   is its active session; older rows stay so each session can still post its final reply.
 * - sessions gains `slack_owner` (the owner's Slack user id) and `slack_approvals` (JSON object of
 *   Slack user id → 'pending' | 'approved' | 'rejected'): other people in a thread can only steer
 *   a session, which runs as its owner, once the owner approved them.
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE slack_apps ADD COLUMN app_token_encrypted TEXT');
  await knex.raw('ALTER TABLE slack_apps ADD COLUMN client_id TEXT');
  await knex.raw('ALTER TABLE slack_apps ADD COLUMN client_secret_encrypted TEXT');
  await knex.raw('ALTER TABLE slack_apps ADD COLUMN signing_secret_encrypted TEXT');
  await knex.raw('ALTER TABLE slack_apps ADD COLUMN api_app_id TEXT');
  await knex.raw('ALTER TABLE slack_apps ADD COLUMN team_id TEXT');
  await knex.raw('ALTER TABLE slack_apps ADD COLUMN team_name TEXT');
  await knex.raw('ALTER TABLE slack_apps ADD COLUMN bot_user_id TEXT');
  await knex.raw('ALTER TABLE slack_apps ADD COLUMN installed_at TEXT');

  await knex.raw('ALTER TABLE sessions ADD COLUMN slack_owner TEXT');
  await knex.raw('ALTER TABLE sessions ADD COLUMN slack_approvals TEXT');

  await knex.schema.createTable('slack_user_links', (t) => {
    t.increments('id').primary();
    t.integer('slack_app_id').references('id').inTable('slack_apps').notNullable();
    t.string('slack_user_id').notNullable();
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['slack_app_id', 'slack_user_id']);
  });

  await knex.schema.createTable('slack_threads', (t) => {
    t.increments('id').primary();
    t.integer('slack_app_id').references('id').inTable('slack_apps').notNullable();
    t.string('channel_id').notNullable();
    t.string('thread_ts').notNullable();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.integer('user_id').references('id').inTable('users').notNullable();
    // Highest assistant message already posted back, so a turn that ends without new text is quiet.
    t.integer('last_posted_message_id').notNullable().defaultTo(0);
    // `ts` of the "Working…" message currently shown in the thread (null when there is none).
    t.string('status_ts');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['slack_app_id', 'channel_id', 'thread_ts', 'session_id']);
    t.index(['slack_app_id', 'channel_id', 'thread_ts']);
    t.index(['session_id']);
  });
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN slack_approvals');
  await knex.raw('ALTER TABLE sessions DROP COLUMN slack_owner');

  await knex.schema.dropTable('slack_threads');
  await knex.schema.dropTable('slack_user_links');

  await knex.raw('ALTER TABLE slack_apps DROP COLUMN installed_at');
  await knex.raw('ALTER TABLE slack_apps DROP COLUMN bot_user_id');
  await knex.raw('ALTER TABLE slack_apps DROP COLUMN team_name');
  await knex.raw('ALTER TABLE slack_apps DROP COLUMN team_id');
  await knex.raw('ALTER TABLE slack_apps DROP COLUMN api_app_id');
  await knex.raw('ALTER TABLE slack_apps DROP COLUMN signing_secret_encrypted');
  await knex.raw('ALTER TABLE slack_apps DROP COLUMN client_secret_encrypted');
  await knex.raw('ALTER TABLE slack_apps DROP COLUMN client_id');
  await knex.raw('ALTER TABLE slack_apps DROP COLUMN app_token_encrypted');
}
