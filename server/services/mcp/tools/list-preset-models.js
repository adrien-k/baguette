import { z } from 'zod';
import { ok } from '../lib/result.js';

export function createListPresetModelsTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ListPresetModels',
    description:
      'List your enabled preset models from Settings → Agent (id, description, agent_sdk, model, model_params, plus which contexts they are enabled for). Pass context to filter to presets usable for subagents or for new sessions and loops.',
    schema: {
      context: z
        .enum(['subagent', 'new_session'])
        .optional()
        .describe(
          'subagent = presets enabled for StartSubagent; new_session = presets enabled for CreateSession and loops. Omit for all enabled presets.'
        ),
    },
    handler: async (args) => {
      // Flags are stored as SQLite integers, so filter with 1/0 bindings.
      const query = { enabled: 1 };
      if (args?.context === 'subagent') query.for_subagents = 1;
      if (args?.context === 'new_session') query.for_new_sessions = 1;
      const { data } = await app.service('agent-model-presets').find({
        query,
        user: { id: userId },
        provider: 'rest',
      });
      return ok({ presets: data ?? [] });
    },
  };
}
