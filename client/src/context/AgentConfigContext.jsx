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
import { modelsKeptForFetch, shouldFetchModels } from '../utils/agentConfigModelCache.js';
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

  const reload = useCallback((opts = {}) => {
    const silent = Boolean(opts.silent);
    if (!silent) setLoading(true);
    return agentConfigsService
      .find()
      .then((res) => setConfigs(res.data ?? []))
      .catch((err) => {
        if (silent) return;
        setConfigs([]);
        toastError('Failed to load agent configurations', err);
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, []);

  const dropModelCache = useCallback((configId) => {
    if (configId == null || configId === '') return;
    const key = String(configId);
    modelCacheKeysRef.current.delete(key);
    delete modelGenRef.current[key];
    const nextRef = { ...modelCacheRef.current };
    delete nextRef[key];
    modelCacheRef.current = nextRef;
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

  const ensureModels = useCallback((configId, { force = false } = {}) => {
    if (configId == null || configId === '') return;
    const key = String(configId);
    const entry = modelCacheRef.current[key];
    if (!shouldFetchModels(entry?.status, { force })) return;

    const gen = (modelGenRef.current[key] ?? 0) + 1;
    modelGenRef.current[key] = gen;
    modelCacheKeysRef.current.add(key);
    modelCacheRef.current = {
      ...modelCacheRef.current,
      [key]: { models: modelsKeptForFetch(entry), status: 'loading' },
    };

    setModelCache((prev) => {
      if (modelGenRef.current[key] !== gen) return prev;
      const next = {
        ...prev,
        [key]: { models: modelsKeptForFetch(prev[key] ?? entry), status: 'loading' },
      };
      modelCacheRef.current = next;
      return next;
    });

    fetchAgentConfigModels({ agentConfigId: Number(key) })
      .then(({ models: list }) => {
        if (modelGenRef.current[key] !== gen) return;
        setModelCache((prev) => {
          if (modelGenRef.current[key] !== gen) return prev;
          const next = { ...prev, [key]: { models: list, status: 'ready' } };
          modelCacheRef.current = next;
          return next;
        });
      })
      .catch(() => {
        if (modelGenRef.current[key] !== gen) return;
        setModelCache((prev) => {
          if (modelGenRef.current[key] !== gen) return prev;
          const previous = modelsKeptForFetch(prev[key] ?? entry);
          const next = { ...prev, [key]: { models: previous, status: 'error' } };
          modelCacheRef.current = next;
          return next;
        });
      });
  }, []);

  const refetchCachedModels = useCallback(() => {
    const keys = [...modelCacheKeysRef.current];
    for (const key of keys) {
      ensureModels(key, { force: true });
    }
  }, [ensureModels]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const onCreated = () => reload();
    const onPatched = (row) => {
      reload();
      if (row?.id != null) ensureModels(row.id, { force: true });
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
  }, [reload, dropModelCache, ensureModels]);

  useRefetchOnSseReconnect((opts) => {
    reload({ silent: opts?.silent !== false });
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
