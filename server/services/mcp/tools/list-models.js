import { z } from 'zod';
import { listModelsForUser } from '../../baguette-models-for-user.js';
import { ok, fail } from '../lib/result.js';

export function createListModelsTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ListModels',
    description:
      'List agent models grouped by SDK, including session usage counts. Pass agent_config_id from your agent configurations (Settings → Agent). Prefer models with higher session_count.',
    schema: {
      agent_config_id: z
        .number()
        .int()
        .describe(
          'Agent configuration id (required). Models use this config’s SDK and credentials.'
        ),
    },
    handler: async ({ agent_config_id: agentConfigId }) => {
      if (agentConfigId == null) {
        return fail(
          'agent_config_id is required. Create agent configurations in Settings → Agent.'
        );
      }
      try {
        const fullUser = await app.service('users').get(userId, {});
        const result = await listModelsForUser(fullUser, null, app, {
          agentConfigId: Number(agentConfigId),
        });
        return ok(result);
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
