/** Server-side gate for registering and routing the mock agent (not client UI). */
export function isMockAgentServerEnabled() {
  return process.env.ENABLE_MOCK_AGENT === 'true';
}
