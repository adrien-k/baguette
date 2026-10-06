import loadPrompt from '../../../prompts/loadPrompt.js';
import { ok } from '../lib/result.js';

export function createConfigRepoPromptTool() {
  return {
    name: 'ConfigRepoPrompt',
    description:
      'Get the onboarding instructions for configuring this repository (.baguette.yaml setup).',
    schema: {},
    handler: async () => {
      const prompt = await loadPrompt('onboarding-prompt', {});
      return ok({ prompt });
    },
  };
}
