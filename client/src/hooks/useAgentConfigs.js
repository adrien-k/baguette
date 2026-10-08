import { useCallback, useEffect, useMemo, useState } from 'react';
import { agentConfigsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';

/** @returns {{ configs: object[], configOptions: { key: string, label: string, sdk: string, logo: string | null, default_model: object }[], loading: boolean, reload: () => Promise<void> }} */
export function useAgentConfigs() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const refresh = () => reload();
    agentConfigsService.on('created', refresh);
    agentConfigsService.on('patched', refresh);
    agentConfigsService.on('removed', refresh);
    return () => {
      agentConfigsService.off('created', refresh);
      agentConfigsService.off('patched', refresh);
      agentConfigsService.off('removed', refresh);
    };
  }, [reload]);

  const configOptions = useMemo(
    () =>
      configs.map((c) => ({
        key: String(c.id),
        label: c.label,
        sdk: c.sdk,
        logo: c.logo ?? null,
        default_model: c.default_model,
      })),
    [configs]
  );

  return { configs, configOptions, loading, reload };
}
