import { useEffect } from 'react';
import { useAgentConfigContext } from '../context/AgentConfigContext.jsx';

/**
 * Model list for an agent config (shared cache). Stale until fetch completes or on error (not stuck loading).
 */
export function useAgentConfigModels(configId, { enabled = true } = {}) {
  const { ensureModels, getModels, modelsStatus } = useAgentConfigContext();

  useEffect(() => {
    if (!enabled || configId == null || configId === '') return;
    ensureModels(configId);
  }, [configId, enabled, ensureModels]);

  const status = modelsStatus(configId);
  const models = getModels(configId);
  const stale =
    !enabled || configId == null || configId === '' || status === 'idle' || status === 'loading';

  return { models, stale };
}
