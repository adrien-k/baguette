/**
 * Loosen the `session_messages` tool_call unique key so the same `tool_call_id`
 * can be re-used across separate tool invocations for one agent.
 *
 * Migration 061 moved uniqueness from `(session_id, tool_call_id, tool_started_at)`
 * to `(agent_id, tool_call_id)`, which reintroduced Cursor SDK crashes: the SDK
 * re-uses `call_id` across distinct invocations in the same run. Each invocation
 * has a distinct `tool_started_at`, so including it in the key prevents collisions
 * while still blocking duplicate rows for the same in-flight call.
 *
 * Replaces:
 *   CREATE UNIQUE INDEX session_messages_agent_tool_call_idx
 *     ON session_messages (agent_id, tool_call_id)
 *     WHERE tool_call_id IS NOT NULL
 * With:
 *   CREATE UNIQUE INDEX session_messages_agent_tool_call_idx
 *     ON session_messages (agent_id, tool_call_id, tool_started_at)
 *     WHERE tool_call_id IS NOT NULL
 */

export async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS session_messages_agent_tool_call_idx');
  await knex.raw(
    'CREATE UNIQUE INDEX session_messages_agent_tool_call_idx ON session_messages (agent_id, tool_call_id, tool_started_at) WHERE tool_call_id IS NOT NULL'
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS session_messages_agent_tool_call_idx');
  await knex.raw(
    'CREATE UNIQUE INDEX session_messages_agent_tool_call_idx ON session_messages (agent_id, tool_call_id) WHERE tool_call_id IS NOT NULL'
  );
}
