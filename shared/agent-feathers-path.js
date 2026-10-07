/** Feathers service path for an agent SDK id. */
export function agentFeathersPath(agentSdk) {
  if (agentSdk === 'cursor') return 'cursor-agent';
  if (agentSdk === 'pi') return 'pi-agent';
  return 'claude-agent';
}
