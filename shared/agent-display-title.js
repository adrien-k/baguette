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

/** U+2060 WORD JOINER — invisible; prevents GitHub from autolinking `#N` in markdown. */
export const GITHUB_REF_WORD_JOINER = '\u2060';

function agentRefPrefix(agent, { github = false } = {}) {
  if (agent?.ref == null) return '';
  const ref = github ? `${GITHUB_REF_WORD_JOINER}${agent.ref}` : agent.ref;
  return `#${ref} `;
}

/** Display title with `#ref` prefix when present (disambiguates duplicate default names). */
export function agentAccessibleTitle(agent, options) {
  const title = agentDisplayTitle(agent);
  const prefix = agentRefPrefix(agent, options);
  return prefix ? `${prefix}${title}` : title;
}

/** Like `agentAccessibleTitle`, with a word joiner after `#` for GitHub markdown footers. */
export function agentAccessibleTitleForGithub(agent) {
  return agentAccessibleTitle(agent, { github: true });
}
