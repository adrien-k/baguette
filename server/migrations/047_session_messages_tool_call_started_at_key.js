/**
 * Loosen the `session_messages` tool_call unique key so the same `tool_call_id`
 * can be re-used across separate tool invocations within a session.
 *
 * Cursor's SDK re-uses `call_id` values across distinct tool invocations in
 * the same run (e.g. an `mcp__baguette__CurrentSessionInfo` call followed ~28s
 * later by another). The old index `session_messages_session_tool_call_idx` on
 * `(session_id, tool_call_id)` rejected the second INSERT and crashed the
 * turn. Each invocation has a distinct `tool_started_at`, so including it in
 * the key removes the collision while still preventing two rows for the same
 * in-flight call.
 *
 * Replaces:
 *   CREATE UNIQUE INDEX session_messages_session_tool_call_idx
 *     ON session_messages (session_id, tool_call_id)
 *     WHERE tool_call_id IS NOT NULL
 * With:
 *   CREATE UNIQUE INDEX session_messages_session_tool_call_idx
 *     ON session_messages (session_id, tool_call_id, tool_started_at)
 *     WHERE tool_call_id IS NOT NULL
 */

export async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS session_messages_session_tool_call_idx');
  await knex.raw(
    'CREATE UNIQUE INDEX session_messages_session_tool_call_idx ON session_messages (session_id, tool_call_id, tool_started_at) WHERE tool_call_id IS NOT NULL'
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS session_messages_session_tool_call_idx');
  // The down migration restores the original (session_id, tool_call_id) key.
  // Note: any pre-existing duplicate (session_id, tool_call_id) rows with
  // distinct tool_started_at will block index creation; resolve before
  // running down.
  await knex.raw(
    'CREATE UNIQUE INDEX session_messages_session_tool_call_idx ON session_messages (session_id, tool_call_id) WHERE tool_call_id IS NOT NULL'
  );
}
