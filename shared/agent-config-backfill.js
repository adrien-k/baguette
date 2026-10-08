/** @typedef {{ primary: number | null, token: number | null, cursor: number | null, pi: number | null }} ScopeConfigIds */

/**
 * Pick config id for session/loop backfill after migrating legacy credentials.
 * @param {ScopeConfigIds | undefined} repoScope
 * @param {ScopeConfigIds | undefined} accountScope
 * @param {string} sdk — session agent_sdk
 */
export function pickAgentConfigIdForSessionBackfill(repoScope, accountScope, sdk) {
  const scope = repoScope ?? accountScope;
  if (!scope) return null;
  if (sdk === 'cursor') return scope.cursor ?? null;
  if (sdk === 'claude') {
    if (scope.token != null && scope.primary == null) return scope.token;
    return scope.primary ?? scope.token ?? null;
  }
  if (sdk === 'pi') return scope.pi ?? null;
  return scope.primary ?? scope.cursor ?? scope.token ?? scope.pi ?? null;
}
