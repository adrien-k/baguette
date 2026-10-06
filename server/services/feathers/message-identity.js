/** Default chat finds to builder rows; review UIs pass agent_type: 'reviewer'. */
export function scopeAgentTypeDefaultFind(context) {
  if (context.method === 'find') {
    context.params.query = { agent_type: 'builder', ...context.params.query };
  }
  return context;
}

export {
  normalizeAgentType,
  requireMessageIdentity,
  requireQueuedMessageIdentity,
  sessionMessageIdentity,
} from './message-create-fields.js';
