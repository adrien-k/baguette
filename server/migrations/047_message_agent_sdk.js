/**
 * Persist which SDK owns a message or queued row (`agent_sdk`, like loops), and tag queued turns by agent_type.
 */

export async function up(knex) {
  if (!(await knex.schema.hasColumn('session_messages', 'agent_sdk'))) {
    await knex.raw('ALTER TABLE session_messages ADD COLUMN agent_sdk TEXT');
  }
  await knex.raw(`
    UPDATE session_messages
    SET agent_sdk = (
      SELECT CASE
        WHEN session_messages.agent_type = 'reviewer'
          THEN COALESCE(sessions.review_agent_sdk, sessions.agent_sdk, 'claude')
        ELSE COALESCE(sessions.agent_sdk, 'claude')
      END
      FROM sessions WHERE sessions.id = session_messages.session_id
    )
    WHERE agent_sdk IS NULL
  `);

  if (!(await knex.schema.hasColumn('queued_messages', 'agent_type'))) {
    await knex.raw(
      "ALTER TABLE queued_messages ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'builder'"
    );
  }

  if (!(await knex.schema.hasColumn('queued_messages', 'agent_sdk'))) {
    await knex.raw('ALTER TABLE queued_messages ADD COLUMN agent_sdk TEXT');
  }
  await knex.raw(`
    UPDATE queued_messages
    SET agent_sdk = (
      SELECT CASE
        WHEN queued_messages.agent_type = 'reviewer'
          THEN COALESCE(sessions.review_agent_sdk, sessions.agent_sdk, 'claude')
        ELSE COALESCE(sessions.agent_sdk, 'claude')
      END
      FROM sessions WHERE sessions.id = queued_messages.session_id
    )
    WHERE agent_sdk IS NULL
  `);
}

export async function down(knex) {
  if (await knex.schema.hasColumn('queued_messages', 'agent_sdk')) {
    await knex.raw('ALTER TABLE queued_messages DROP COLUMN agent_sdk');
  }
  if (await knex.schema.hasColumn('queued_messages', 'agent_type')) {
    await knex.raw('ALTER TABLE queued_messages DROP COLUMN agent_type');
  }
  if (await knex.schema.hasColumn('session_messages', 'agent_sdk')) {
    await knex.raw('ALTER TABLE session_messages DROP COLUMN agent_sdk');
  }
}
