import { useEffect } from 'react';
import { useAgentConfigContext } from '../context/AgentConfigContext.jsx';

/**
 * Model list for an agent config (shared cache). Stale until fetch completes or on error (not stuck loading).
 * Idle (including after the cache entry is removed) starts a fetch; error does not retry on its own.
 */
export function useAgentConfigModels(configId, { enabled = true } = {}) {
  const { ensureModels, getModels, modelsStatus } = useAgentConfigContext();
  const status = modelsStatus(configId);

  useEffect(() => {
    if (!enabled || configId == null || configId === '') return;
    if (status === 'loading' || status === 'ready' || status === 'error') return;
    ensureModels(configId);
  }, [configId, enabled, ensureModels, status]);

  const models = getModels(configId);
  const stale =
    !enabled || configId == null || configId === '' || status === 'idle' || status === 'loading';

  return { models, stale };
}
