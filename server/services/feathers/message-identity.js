import { getPrimaryBuilderAgent } from '../agents-db.js';

/** Default message finds to the session primary builder when agent_id is omitted. */
export async function scopeAgentDefaultFind(context) {
  if (context.method !== 'find') return context;
  const query = context.params.query || {};
  if (query.include_all_agents) {
    const next = { ...query };
    delete next.include_all_agents;
    context.params.query = next;
    return context;
  }
  if (query.agent_id != null || query.agent_type === 'reviewer') {
    return context;
  }
  const sessionId = query.session_id;
  if (!sessionId) return context;

  const db = context.app.get('db');
  const primary = await getPrimaryBuilderAgent(db, sessionId);
  if (primary) {
    context.params.query = { agent_id: primary.id, ...query };
    delete context.params.query.agent_type;
  } else {
    context.params.query = { agent_type: 'builder', ...query };
  }
  return context;
}

export { requireMessageIdentity, requireQueuedMessageIdentity } from './message-create-fields.js';
