export function agentTypeLabel(agentType) {
  if (agentType === 'reviewer') return 'Reviewer';
  if (agentType === 'subagent') return 'Subagent';
  return 'Builder';
}

/** True when stored name is just the default type label (e.g. "Builder" / "builder"). */
export function agentNameMatchesType(name, agentType) {
  if (!name || !agentType) return false;
  const normalized = name.trim().toLowerCase();
  const type = agentType.trim().toLowerCase();
  const label = agentTypeLabel(agentType).toLowerCase();
  return normalized === type || normalized === label;
}

/** Primary label for lists and PR footers. */
export function agentDisplayTitle(agent) {
  if (!agent) return 'Agent';
  const typeLabel = agentTypeLabel(agent.agent_type);
  if (agentNameMatchesType(agent.name, agent.agent_type)) return typeLabel;
  const name = agent.name?.trim();
  return name || typeLabel;
}

function agentRefPrefix(agent) {
  if (agent?.ref == null) return '';
  return `#${agent.ref} `;
}

/** Display title with `#ref` prefix when present (disambiguates duplicate default names). */
export function agentAccessibleTitle(agent) {
  const title = agentDisplayTitle(agent);
  const prefix = agentRefPrefix(agent);
  return prefix ? `${prefix}${title}` : title;
}
