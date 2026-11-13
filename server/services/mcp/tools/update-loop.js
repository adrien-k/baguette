import { z } from 'zod';
import { normalizeSubagentDefaultMode } from '../../../../shared/subagent-default-mode.js';
import { ok, fail } from '../lib/result.js';
import { loopPatchSchema } from '../lib/loop-schemas.js';
import { applyLoopPresetModel } from '../lib/apply-loop-preset-model.js';
import { agentCreatedModelClause } from '../lib/agent-created-model-fields.js';

function loopPatchTouchesModel(patch) {
  if (patch.preset_model_id != null) return true;
  if (patch.agent_config_id != null) return true;
  if (patch.model != null && String(patch.model).trim() !== '') return true;
  if (patch.model_params != null) return true;
  return false;
}

export function createUpdateLoopTool(ctx) {
  const { app, userId, user } = ctx;
  const mode = normalizeSubagentDefaultMode(user?.subagent_default_mode);
  const userParams = { provider: 'rest', user: { id: userId } };
  return {
    name: 'UpdateLoop',
    description:
      'Patch an existing loop. Only include fields to change. ' +
      agentCreatedModelClause(mode, 'loop'),
    schema: {
      loop_id: z.number().int(),
      repo_full_name: z.string().optional(),
      ...loopPatchSchema(mode),
    },
    handler: async ({ loop_id, ...patch }) => {
      try {
        if (loopPatchTouchesModel(patch)) {
          await applyLoopPresetModel(app, userId, patch);
        }
        const loop = await app.service('loops').patch(loop_id, patch, userParams);
        return ok({ loop });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
