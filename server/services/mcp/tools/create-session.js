import { z } from 'zod';
import { availableAgentSdks } from '../../../../shared/agent-sdk-credentials.js';
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
      'Stored Cursor defaults include model_params; variant_index on this call still overrides params when set. Pass is_global to start a global session from the shared repos folder (no repo_id or base_branch).',
    schema: {
      repo_id: z
        .number()
        .int()
        .optional()
        .describe('Repository id from ListRepos (omit when is_global)'),
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
        .enum(['claude', 'cursor', 'pi'])
        .optional()
        .describe('Agent SDK (default: Settings → Agent, else claude)'),
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
      if (!is_global && (repo_id == null || !base_branch)) {
        return fail('repo_id and base_branch are required unless is_global is true.');
      }

      let fullUser;
      try {
        fullUser = await app.service('users').get(userId, {});
      } catch (err) {
        return fail(err.message);
      }

      let repo = null;
      let repoWithKeys = null;
      if (!is_global) {
        repo = await requireRepoAccess(repo_id);
        if (!repo) return fail(`Repository ${repo_id} not found or not linked to your account.`);
        repoWithKeys = await loadRepoWithKeys(repo_id);
      }

      const storedDefaults = parseAgentSessionDefaultsJson(fullUser.agent_defaults);
      const lastUsed = isLastUsedAgentDefaults(storedDefaults)
        ? await getLastUsedSessionAgent(app.get('db'), userId)
        : null;
      const { agent_sdk, model, model_params, variant_index } = resolveCreateSessionAgentFields(
        {
          agent_sdk: agentSdkArg,
          model: modelArg,
          variant_index: variantIndexArg,
        },
        storedDefaults,
        lastUsed
      );

      const allowedSdks = availableAgentSdks(fullUser, repoWithKeys);
      if (!allowedSdks.includes(agent_sdk)) {
        return fail(
          `No API key configured for agent_sdk "${agent_sdk}" on your account or this repository. Add keys in Settings → Agent or repository settings.`
        );
      }

      const prefs = parseCursorModelPrefsJson(fullUser.agent_preferences);
      let modelParams;
      if (agent_sdk === 'cursor' && model) {
        try {
          const models = await loadModelsForSdk(fullUser, 'cursor', repoWithKeys);
          if (!models.some((m) => m.id === model)) {
            return fail(`Unknown cursor model "${model}". Call ListModels first.`);
          }
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
        } catch (err) {
          return fail(err.message);
        }
      } else if (agent_sdk === 'claude' && model) {
        const models = await loadModelsForSdk(fullUser, 'claude', repoWithKeys);
        if (!models.some((m) => m.id === model)) {
          return fail(`Unknown claude model "${model}". Call ListModels first.`);
        }
      } else if (agent_sdk === 'pi' && model) {
        const models = await loadModelsForSdk(fullUser, 'pi', repoWithKeys);
        if (!models.some((m) => m.id === model)) {
          return fail(`Unknown pi model "${model}". Call ListModels first.`);
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
        payload.repo_full_name = repo.full_name;
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
