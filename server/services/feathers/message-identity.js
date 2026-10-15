import { getPrimaryBuilderAgent } from '../agents-db.js';

/** Default message finds to the session primary builder when agent_id is omitted. */
export async function scopeAgentDefaultFind(context) {
  if (context.method !== 'find') return context;
  const query = { ...(context.params.query || {}) };
  delete query.agent_type;

  if (query.agent_id != null) {
    context.params.query = query;
    return context;
  }
  const sessionId = query.session_id;
  if (!sessionId) {
    context.params.query = query;
    return context;
  }

  const db = context.app.get('db');
  const primary = await getPrimaryBuilderAgent(db, sessionId);
  if (primary) {
    context.params.query = { agent_id: primary.id, ...query };
  } else {
    context.params.query = query;
  }
  return context;
}

export { requireMessageIdentity, requireQueuedMessageIdentity } from './message-create-fields.js';
