/** Human-readable agent SDK name for posts and labels (e.g. `pi` → `Pi`). */
export function formatAgentSdkDisplayName(agentSdk) {
  const raw = typeof agentSdk === 'string' ? agentSdk.trim() : '';
  if (!raw) return 'Agent';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
