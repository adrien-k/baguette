import { getAgentById } from '../services/agents-db.js';
import { normalizeUsageAgentType } from '../../shared/usage-agent-type.js';
import { requireAgentConfigId } from './usage-snapshot.js';
import { usagePricingSnapshotForCost } from './usage-pricing-snapshot.js';

/**
 * Agent + pricing snapshot for a usage insert. SDK plugins assemble the rest of
 * the row (cost derivation, `agent_sdk`, extra columns) then call
 * `sessions.insertUsageRow`.
 *
 * @param {import('knex').Knex} db
 * @param {{ id: number }} session
 * @param {{ agentId?: number|null, turnModel?: { model?: string|null, modelParams?: unknown }|null, turnUsage?: { model?: string|null }|null, agentConfigId?: number|null }} opts
 */
export async function resolveUsageRecordContext(
  db,
  session,
  { agentId, turnModel, turnUsage, agentConfigId } = {}
) {
  const agent =
    agentId != null
      ? await getAgentById(db, agentId)
      : await db('agents').where({ session_id: session.id, is_primary: 1 }).first();
  return {
    agent,
    agent_type: normalizeUsageAgentType(agent?.agent_type),
    snapshot: usagePricingSnapshotForCost(turnModel, turnUsage),
    agent_config_id: requireAgentConfigId(agentConfigId),
  };
}

/** Token columns shared by Claude / Cursor / Pi usage rows. */
export function usageRowTokenFields(turnUsage) {
  return {
    input_tokens: turnUsage.input_tokens,
    output_tokens: turnUsage.output_tokens,
    cache_read_tokens: turnUsage.cache_read_tokens,
    cache_write_tokens: turnUsage.cache_write_tokens,
    reasoning_tokens: turnUsage.reasoning_tokens,
    total_tokens: turnUsage.total_tokens,
  };
}
