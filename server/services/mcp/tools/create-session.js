import { z } from 'zod';
import { resolveCursorModelParams } from '../../../../shared/model-variants.js';
import { parseCursorModelPrefsJson } from '../../agent-preferences.js';
import {
  isLastUsedAgentDefaults,
  parseAgentSessionDefaultsJson,
  resolveCreateSessionAgentFields,
} from '../../agent-session-defaults.js';
import { getLastUsedSessionAgent } from '../../last-used-session-agent.js';
import { loadModelsForSdk } from '../../baguette-models-for-user.js';
import { ok, fail } from '../lib/result.js';

export function createCreateSessionTool(ctx) {
  const { app, userId, userParams, requireRepoAccess, loadRepoWithKeys } = ctx;
  return {
    name: 'CreateSession',
    description:
      'IMPORTANT: Do not use this tool unless the user explicitly asks you to create a new session. ' +
      'Create a new Baguette agent session (same fields as the dashboard form). Use ListBranches for base_branch and ListModels for agent_sdk + model. ' +
      'Omitted agent_sdk, model, and variant_index use your Settings → Agent session defaults (explicit params override defaults). ' +
      'Stored Cursor defaults include model_params; variant_index on this call still overrides params when set. Pass is_global to start a global session from the shared repos folder (repo_id still required for credentials and models; omit base_branch when is_global).',
    schema: {
      repo_id: z
        .number()
        .int()
        .describe('Repository id from ListRepos (required, including for is_global sessions)'),
      base_branch: z
        .string()
        .optional()
        .describe('Base branch from ListBranches (omit when is_global)'),
      is_global: z
        .boolean()
        .optional()
        .describe('Start a global session in the shared repos folder (no git/PR tools)'),
      initial_prompt: z.string().describe('Initial user prompt for the agent'),
      agent_sdk: z
        .string()
        .optional()
        .describe(
          'Agent SDK key from ListModels (default: Settings → Agent, else first enabled SDK for the repo). Availability is checked against registered SDKs that are enabled for the repo.'
        ),
      model: z
        .string()
        .optional()
        .describe('Model id from ListModels (default: Settings → Agent when SDK matches)'),
      variant_index: z
        .number()
        .int()
        .optional()
        .describe('Cursor variant index from ListModels (default: Settings → Agent)'),
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
      agent_sdk: agentSdkArg,
      model: modelArg,
      variant_index: variantIndexArg,
      create_new_branch = true,
      branch_name,
      auto_push = true,
      plan_mode = false,
      plugins,
    }) => {
      if (repo_id == null) {
        return fail('repo_id is required');
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

      const access = await requireRepoAccess(repo_id);
      if (!access) {
        return fail(`Repository ${repo_id} not found or not linked to your account.`);
      }
      const repoWithKeys = (await loadRepoWithKeys(repo_id)) ?? {
        id: access.id,
        full_name: access.full_name,
      };

      const sdkCtx = { user: fullUser, repo: repoWithKeys };
      const allowedSdks = await app.service('agent-sdks').listEnabled(sdkCtx);
      const defaultSdk = allowedSdks[0]?.key ?? null;

      const storedDefaults = parseAgentSessionDefaultsJson(fullUser.agent_defaults);
      const lastUsed = isLastUsedAgentDefaults(storedDefaults)
        ? await getLastUsedSessionAgent(app.get('db'), userId)
        : null;
      let { agent_sdk, model, model_params, variant_index } = resolveCreateSessionAgentFields(
        {
          agent_sdk: agentSdkArg,
          model: modelArg,
          variant_index: variantIndexArg,
        },
        storedDefaults,
        lastUsed,
        defaultSdk
      );
      if (!agent_sdk) agent_sdk = defaultSdk;

      if (!agent_sdk || !(await app.service('agent-sdks').isEnabled(agent_sdk, sdkCtx))) {
        return fail(
          `Agent SDK "${agent_sdk}" is not available for this repository. Add keys in Settings → Agent or repository settings.`
        );
      }

      const prefs = parseCursorModelPrefsJson(fullUser.agent_preferences);
      let modelParams;
      if (model) {
        try {
          const models = await loadModelsForSdk(fullUser, agent_sdk, repoWithKeys, app);
          if (!models.some((m) => m.id === model)) {
            return fail(`Unknown ${agent_sdk} model "${model}". Call ListModels first.`);
          }
          if (agent_sdk === 'cursor') {
            const defaultsParamsJson = model_params?.length
              ? JSON.stringify(model_params)
              : undefined;
            modelParams = resolveCursorModelParams({
              models,
              modelId: model,
              modelParamsJson: variant_index == null ? defaultsParamsJson : undefined,
              variantIndex: variant_index,
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
