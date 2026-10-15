import { useAgentConfigContext } from '../context/AgentConfigContext.jsx';

/** @returns {{ configs: object[], configOptions: { key: string, label: string, sdk: string, logo: string | null, default_model: object }[], loading: boolean, reload: () => Promise<void> }} */
export function useAgentConfigs() {
  const { configs, configOptions, loading, reload } = useAgentConfigContext();
  return { configs, configOptions, loading, reload };
}
