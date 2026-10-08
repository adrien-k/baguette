import { z } from 'zod';
import { resolveCursorModelParams } from '../../../../shared/model-variants.js';
import { parseCursorModelPrefsJson } from '../../agent-preferences.js';
import { loadModelsForSdk } from '../../baguette-models-for-user.js';
import {
  loadOwnedAgentConfig,
  resolveEffectiveAgentDefaults,
} from '../../agent-config-resolver.js';
import { ok, fail } from '../lib/result.js';

export function createCreateSessionTool(ctx) {
  const { app, userId, userParams, requireRepoAccess, loadRepoWithKeys } = ctx;
  return {
    name: 'CreateSession',
    description:
      'IMPORTANT: Do not use this tool unless the user explicitly asks you to create a new session. ' +
      'Create a new Baguette agent session (same fields as the dashboard form). Use ListBranches for base_branch and ListModels with agent_config_id + model. ' +
      'Omitted agent_config_id uses your saved agent defaults or your most recent session’s configuration when available. Pass is_global to start a global session from the shared repos folder (omit base_branch and repo_id when is_global).',
    schema: {
      repo_id: z
        .number()
        .int()
        .optional()
        .describe('Repository id from ListRepos (required for repo sessions; omit when is_global)'),
      base_branch: z
        .string()
        .optional()
        .describe('Base branch from ListBranches (omit when is_global)'),
      is_global: z
        .boolean()
        .optional()
        .describe('Start a global session in the shared repos folder (no git/PR tools)'),
      initial_prompt: z.string().describe('Initial user prompt for the agent'),
      agent_config_id: z
        .number()
        .int()
        .optional()
        .describe('Agent configuration id from Settings → Agent (default: last session config)'),
      model: z.string().optional().describe('Model id from ListModels for the chosen config'),
      variant_index: z.number().int().optional().describe('Cursor variant index from ListModels'),
      create_new_branch: z
        .boolean()
        .optional()
        .describe('Create a new working branch (default true)'),
      branch_name: z.string().optional().describe('Optional new branch name'),
      auto_push: z.boolean().optional().describe('Auto-push commits (default true)'),
      plan_mode: z.boolean().optional().describe('Start in plan mode'),
      plugins: z.array(z.string()).optional().describe('Plugin ids to enable'),
    },
    handler: async ({
      repo_id,
      base_branch,
      is_global = false,
      initial_prompt,
      agent_config_id: agentConfigIdArg,
      model: modelArg,
      variant_index: variantIndexArg,
      create_new_branch = true,
      branch_name,
      auto_push = true,
      plan_mode = false,
      plugins,
    }) => {
      if (!is_global && repo_id == null) {
        return fail('repo_id is required unless is_global is true');
      }
      if (!is_global && !base_branch) {
        return fail('base_branch is required unless is_global is true.');
      }

      let fullUser;
      try {
        fullUser = await app.service('users').get(userId, {});
      } catch (err) {
        return fail(err.message);
      }

      let repoWithKeys = null;
      if (!is_global) {
        const access = await requireRepoAccess(repo_id);
        if (!access) {
          return fail(`Repository ${repo_id} not found or not linked to your account.`);
        }
        repoWithKeys = (await loadRepoWithKeys(repo_id)) ?? {
          id: access.id,
          full_name: access.full_name,
        };
      }

      const db = app.get('db');
      let agentConfigId = agentConfigIdArg ?? null;
      let model = modelArg ?? null;
      let defaultModelParams;
      if (agentConfigId == null || model == null) {
        const effective = await resolveEffectiveAgentDefaults(db, userId);
        if (agentConfigId == null) agentConfigId = effective?.agent_config_id ?? null;
        if (!model && effective?.model) model = effective.model;
        if (variantIndexArg == null && effective?.model_params?.length) {
          defaultModelParams = effective.model_params;
        }
      }
      if (agentConfigId == null) {
        return fail(
          'agent_config_id is required. Add an agent configuration in Settings → Agent or pass agent_config_id explicitly.'
        );
      }

      let config;
      try {
        config = await loadOwnedAgentConfig(db, agentConfigId, userId);
      } catch (err) {
        return fail(err.message);
      }

      const agent_sdk = config.sdk;
      if (!app.service('agent-configs').getSdkMeta(agent_sdk)) {
        return fail(`Agent SDK "${agent_sdk}" is not available for this configuration.`);
      }

      const prefs = parseCursorModelPrefsJson(fullUser.agent_preferences);
      let modelParams;
      if (model) {
        try {
          const models = await loadModelsForSdk(fullUser, agent_sdk, null, app, {
            agentConfigId,
          });
          if (!models.some((m) => m.id === model)) {
            return fail(`Unknown ${agent_sdk} model "${model}". Call ListModels first.`);
          }
          if (agent_sdk === 'cursor') {
            modelParams =
              defaultModelParams ??
              resolveCursorModelParams({
                models,
                modelId: model,
                modelParamsJson: undefined,
                variantIndex: variantIndexArg,
                cursorModelPrefs: prefs,
              });
          }
        } catch (err) {
          return fail(err.message);
        }
      }

      const payload = {
        initial_prompt,
        plan_mode: Boolean(plan_mode),
        agent_config_id: agentConfigId,
        agent_sdk,
      };
      if (is_global) {
        payload.is_global = true;
      } else {
        payload.repo_full_name = repoWithKeys.full_name;
        payload.base_branch = base_branch;
        payload.create_new_branch = create_new_branch;
        payload.auto_push = auto_push;
      }
      if (model) payload.model = model;
      if (modelParams) payload.model_params = modelParams;
      if (!is_global && branch_name) payload.branch_name = branch_name;
      if (plugins?.length) payload.plugins = plugins;

      try {
        const session = await app.service('sessions').create(payload, {
          ...userParams,
          user: fullUser,
        });
        return ok({
          sessionId: session.id,
          shortId: session.short_id,
          sessionPath: `/sessions/${session.id}`,
          message: `Session created: /sessions/${session.id}`,
        });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
