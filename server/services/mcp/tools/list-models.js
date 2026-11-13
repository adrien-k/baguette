import { z } from 'zod';
import {
  SUBAGENT_DEFAULT_ANY,
  normalizeSubagentDefaultMode,
} from '../../../../shared/subagent-default-mode.js';
import { listModelsForUser } from '../../baguette-models-for-user.js';
import { ok, fail } from '../lib/result.js';

export function createListModelsTool(ctx) {
  const { app, userId, user } = ctx;
  const allowAllConfigs =
    normalizeSubagentDefaultMode(user?.subagent_default_mode) === SUBAGENT_DEFAULT_ANY;
  const agentConfigField = allowAllConfigs
    ? z
        .number()
        .int()
        .optional()
        .describe(
          'Agent configuration id. Omit to list models for every configuration. Each model includes agent_config_id.'
        )
    : z
        .number()
        .int()
        .describe(
          'Agent configuration id (required). Models use this config’s SDK and credentials.'
        );
  return {
    name: 'ListModels',
    description: allowAllConfigs
      ? 'List agent models grouped by SDK, including session usage counts and agent_config_id. Omit agent_config_id to list every configuration. Prefer models with higher session_count. Pass agent_config_id and model when Settings → Agent allows any model.'
      : 'List agent models grouped by SDK, including session usage counts. Pass agent_config_id from your agent configurations (Settings → Agent). Prefer models with higher session_count.',
    schema: {
      agent_config_id: agentConfigField,
    },
    handler: async ({ agent_config_id: agentConfigId }) => {
      if (!allowAllConfigs && agentConfigId == null) {
        return fail(
          'agent_config_id is required. Create agent configurations in Settings → Agent.'
        );
      }
      try {
        const fullUser = await app.service('users').get(userId, {});
        const result = await listModelsForUser(fullUser, null, app, {
          agentConfigId: agentConfigId != null ? Number(agentConfigId) : null,
        });
        return ok(result);
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
