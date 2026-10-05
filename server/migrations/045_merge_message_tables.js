/**
 * Merge chat messages and review messages into a single `session_messages`
 * table, differentiated by `agent_type` ('builder' | 'reviewer').
 *
 * Also adds the turn / tool-call columns previously introduced here:
 * - sessions: current_turn_id, active_chat_turn_id, active_review_turn_id
 * - session_messages: turn_id, tool_call_id, tool_status, tool_started_at, tool_ended_at
 *
 * Legacy row shapes (tool-result-only `user` rows, assistant `tool_use` blobs,
 * `result` rows) are normalized by scripts/2026100601_backfill-message-rows.js, NOT by this
 * migration — run that script after migrating existing data.
 *
 * DEPRECATED shapes (do not recreate):
 * - `user` rows whose message_json is only tool_result blocks (merged into tool_call rows).
 * - `uuid` on messages — SDK artifact, unused for lookups (candidate DROP later).
 */

const MESSAGE_COLUMNS = [
  ['turn_id', 'INTEGER'],
  ['tool_call_id', 'TEXT'],
  ['tool_status', 'TEXT'],
  ['tool_started_at', 'TEXT'],
  ['tool_ended_at', 'TEXT'],
];

export async function up(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'current_turn_id'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN current_turn_id INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await knex.schema.hasColumn('sessions', 'active_chat_turn_id'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN active_chat_turn_id INTEGER');
  }
  if (!(await knex.schema.hasColumn('sessions', 'active_review_turn_id'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN active_review_turn_id INTEGER');
  }

  for (const [column, type] of MESSAGE_COLUMNS) {
    if (!(await knex.schema.hasColumn('session_messages', column))) {
      await knex.raw(`ALTER TABLE session_messages ADD COLUMN ${column} ${type}`);
    }
  }
  if (!(await knex.schema.hasColumn('session_messages', 'agent_type'))) {
    await knex.raw(
      "ALTER TABLE session_messages ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'builder'"
    );
  }

  // Fold review messages into the shared table before dropping the old table.
  if (await knex.schema.hasTable('session_review_messages')) {
    await knex.raw(`
      INSERT INTO session_messages
        (session_id, type, subtype, uuid, message_json, total_cost_usd, created_at, agent_type)
      SELECT session_id, type, subtype, uuid, message_json, total_cost_usd, created_at, 'reviewer'
      FROM session_review_messages
    `);
    await knex.schema.dropTable('session_review_messages');
  }

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS session_messages_session_turn_idx ON session_messages (session_id, turn_id)'
  );
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS session_messages_session_tool_call_idx ON session_messages (session_id, tool_call_id) WHERE tool_call_id IS NOT NULL'
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS session_messages_session_tool_call_idx');
  await knex.raw('DROP INDEX IF EXISTS session_messages_session_turn_idx');

  if (!(await knex.schema.hasTable('session_review_messages'))) {
    await knex.schema.createTable('session_review_messages', (t) => {
      t.increments('id').primary();
      t.integer('session_id').references('id').inTable('sessions').notNullable();
      t.string('type').notNullable();
      t.string('subtype');
      t.string('uuid');
      t.text('message_json').notNullable();
      t.decimal('total_cost_usd', 12, 6);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (await knex.schema.hasColumn('session_messages', 'agent_type')) {
    await knex.raw(`
      INSERT INTO session_review_messages
        (session_id, type, subtype, uuid, message_json, total_cost_usd, created_at)
      SELECT session_id, type, subtype, uuid, message_json, total_cost_usd, created_at
      FROM session_messages
      WHERE agent_type = 'reviewer'
    `);
    await knex.raw('ALTER TABLE session_messages DROP COLUMN agent_type');
  }

  for (const [column] of [...MESSAGE_COLUMNS].reverse()) {
    if (await knex.schema.hasColumn('session_messages', column)) {
      await knex.raw(`ALTER TABLE session_messages DROP COLUMN ${column}`);
    }
  }

  if (await knex.schema.hasColumn('sessions', 'active_review_turn_id')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN active_review_turn_id');
  }
  if (await knex.schema.hasColumn('sessions', 'active_chat_turn_id')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN active_chat_turn_id');
  }
  if (await knex.schema.hasColumn('sessions', 'current_turn_id')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN current_turn_id');
  }
}
