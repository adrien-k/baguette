import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { agentConfigsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { fetchAgentConfigModels } from '../utils/fetchAgentSdkModels.js';
import { useRefetchOnSseReconnect } from '../hooks/useRefetchOnSseReconnect.js';

const AgentConfigContext = createContext(null);

function configOptionFromRow(c) {
  return {
    key: String(c.id),
    label: c.label,
    sdk: c.sdk,
    logo: c.logo ?? null,
    default_model: c.default_model,
  };
}

export function AgentConfigProvider({ children }) {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modelCache, setModelCache] = useState({});
  const modelGenRef = useRef({});
  const modelCacheKeysRef = useRef(new Set());
  const modelCacheRef = useRef(modelCache);
  useEffect(() => {
    modelCacheRef.current = modelCache;
  }, [modelCache]);

  const reload = useCallback(() => {
    setLoading(true);
    return agentConfigsService
      .find()
      .then((res) => setConfigs(res.data ?? []))
      .catch((err) => {
        setConfigs([]);
        toastError('Failed to load agent configurations', err);
      })
      .finally(() => setLoading(false));
  }, []);

  const dropModelCache = useCallback((configId) => {
    if (configId == null || configId === '') return;
    const key = String(configId);
    modelCacheKeysRef.current.delete(key);
    delete modelGenRef.current[key];
    setModelCache((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const getConfig = useCallback(
    (id) => {
      if (id == null || id === '') return null;
      const key = String(id);
      const row = configs.find((c) => String(c.id) === key);
      return row ? configOptionFromRow(row) : null;
    },
    [configs]
  );

  const getModels = useCallback(
    (configId) => {
      if (configId == null || configId === '') return [];
      const entry = modelCache[String(configId)];
      return entry?.models ?? [];
    },
    [modelCache]
  );

  const modelsStatus = useCallback(
    (configId) => {
      if (configId == null || configId === '') return 'idle';
      return modelCache[String(configId)]?.status ?? 'idle';
    },
    [modelCache]
  );

  const ensureModels = useCallback((configId) => {
    if (configId == null || configId === '') return;
    const key = String(configId);
    const entry = modelCacheRef.current[key];
    if (entry?.status === 'loading' || entry?.status === 'ready') return;

    const gen = (modelGenRef.current[key] ?? 0) + 1;
    modelGenRef.current[key] = gen;
    modelCacheKeysRef.current.add(key);

    setModelCache((prev) => ({
      ...prev,
      [key]: { models: entry?.status === 'error' ? [] : (entry?.models ?? []), status: 'loading' },
    }));

    fetchAgentConfigModels({ agentConfigId: Number(key) })
      .then(({ models: list }) => {
        if (modelGenRef.current[key] !== gen) return;
        setModelCache((prev) => ({
          ...prev,
          [key]: { models: list, status: 'ready' },
        }));
      })
      .catch(() => {
        if (modelGenRef.current[key] !== gen) return;
        setModelCache((prev) => ({
          ...prev,
          [key]: { models: [], status: 'error' },
        }));
      });
  }, []);

  const refetchCachedModels = useCallback(() => {
    const keys = [...modelCacheKeysRef.current];
    for (const key of keys) {
      dropModelCache(key);
    }
    for (const key of keys) {
      ensureModels(key);
    }
  }, [dropModelCache, ensureModels]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const onCreated = () => reload();
    const onPatched = (row) => {
      reload();
      if (row?.id != null) dropModelCache(row.id);
    };
    const onRemoved = (row) => {
      reload();
      if (row?.id != null) dropModelCache(row.id);
    };
    agentConfigsService.on('created', onCreated);
    agentConfigsService.on('patched', onPatched);
    agentConfigsService.on('removed', onRemoved);
    return () => {
      agentConfigsService.off('created', onCreated);
      agentConfigsService.off('patched', onPatched);
      agentConfigsService.off('removed', onRemoved);
    };
  }, [reload, dropModelCache]);

  useRefetchOnSseReconnect(() => {
    reload();
    refetchCachedModels();
  }, true);

  const configOptions = useMemo(() => configs.map(configOptionFromRow), [configs]);

  const value = useMemo(
    () => ({
      configs,
      configOptions,
      loading,
      reload,
      getConfig,
      ensureModels,
      getModels,
      modelsStatus,
    }),
    [configs, configOptions, loading, reload, getConfig, ensureModels, getModels, modelsStatus]
  );

  return <AgentConfigContext.Provider value={value}>{children}</AgentConfigContext.Provider>;
}

export function useAgentConfigContext() {
  const ctx = useContext(AgentConfigContext);
  if (!ctx) {
    throw new Error('useAgentConfigContext must be used within AgentConfigProvider');
  }
  return ctx;
}
