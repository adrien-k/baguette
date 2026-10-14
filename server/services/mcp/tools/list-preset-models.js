import { ok } from '../lib/result.js';

export function createListPresetModelsTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ListPresetModels',
    description:
      'List your preset models from Settings → Agent (id, description, agent_sdk, model, model_params).',
    schema: {},
    handler: async () => {
      const { data } = await app.service('agent-model-presets').find({
        user: { id: userId },
        provider: 'rest',
      });
      return ok({ presets: data ?? [] });
    },
  };
}
