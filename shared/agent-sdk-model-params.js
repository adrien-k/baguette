/** SDKs that store per-turn `model_params` on sessions and messages. */
export const AGENT_SDKS_WITH_MODEL_PARAMS = new Set(['cursor', 'claude', 'pi']);

export function agentSdkSupportsModelParams(agentSdk) {
  return AGENT_SDKS_WITH_MODEL_PARAMS.has(agentSdk);
}
