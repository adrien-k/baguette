import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { agentModelPresetsService } from '../feathers.js';
import { agentModelPresetKeys } from '../queries/keys.js';
import { feathersFind } from '../queries/feathersFinders.js';
import { toastError } from '../utils/toastError.jsx';

/**
 * Preset models for the Settings → Agent section. Created/patched/removed SSE
 * events merge full rows into the cached list via the central bridge, so flag
 * changes and edits stay live without refetch flashes.
 */
export function useAgentModelPresets() {
  const q = useQuery({
    queryKey: agentModelPresetKeys.list(),
    queryFn: () => feathersFind(agentModelPresetsService, {}),
  });

  useEffect(() => {
    if (q.error) toastError('Failed to load preset models', q.error);
  }, [q.error]);

  return { presets: q.data ?? [], loading: q.isPending, refetch: q.refetch };
}
