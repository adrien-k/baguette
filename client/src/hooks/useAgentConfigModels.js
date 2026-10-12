import { useEffect, useState } from 'react';
import { fetchAgentConfigModels } from '../utils/fetchAgentSdkModels.js';
import { isAgentConfigModelsStale } from '../utils/agentConfigModelsStale.js';

/**
 * Model list for an agent config. The list is stale as soon as `configId` changes
 * (or while disabled) until a fetch for that id completes.
 */
export function useAgentConfigModels(configId, { enabled = true } = {}) {
  const [models, setModels] = useState([]);
  const [loadedForId, setLoadedForId] = useState(null);

  useEffect(() => {
    if (!enabled || configId == null || configId === '') {
      setModels([]);
      setLoadedForId(null);
      return;
    }
    setLoadedForId(null);
    setModels([]);
    let cancelled = false;
    fetchAgentConfigModels({ agentConfigId: Number(configId) })
      .then(({ models: list }) => {
        if (cancelled) return;
        setModels(list);
        setLoadedForId(configId);
      })
      .catch(() => {
        if (cancelled) return;
        setModels([]);
        setLoadedForId(configId);
      });
    return () => {
      cancelled = true;
    };
  }, [configId, enabled]);

  return {
    models,
    stale: !enabled || isAgentConfigModelsStale(loadedForId, configId),
  };
}
