import { z } from 'zod';
import { stringifyModelParamsForStorage } from '../../../../shared/agent-session-defaults.js';
import { resolveCursorModelParams } from '../../../../shared/model-variants.js';
import { resolveClaudeAgentModelParams } from '../../claude-model-params.js';
import { resolvePiAgentModelParams } from '../../pi-model-params.js';
import { parseCursorModelPrefsJson } from '../../agent-preferences.js';
import { loadModelsForSdk } from '../../baguette-models-for-user.js';
import { loadOwnedAgentConfig } from '../../agent-config-resolver.js';
import { resolveMcpBuilderModel } from '../../agent-mcp-model-resolver.js';
import { ok, fail } from '../lib/result.js';

/** Merge optional `branch` with `base_branch` for CreateSession (stacked PR follow-ups). */
export function resolveCreateSessionBaseBranch(baseBranch, branch) {
  if (baseBranch && branch && baseBranch !== branch) {
    return { error: 'base_branch and branch must match when both are set.' };
  }
  const resolved = baseBranch ?? branch;
  if (!resolved) {
    return { error: 'base_branch or branch is required unless is_global is true.' };
  }
  return { base_branch: resolved };
}

export function createCreateSessionTool(ctx) {
  const { app, userId, userParams, requireRepoAccess, loadRepoWithKeys } = ctx;
  return {
    name: 'CreateSession',
    description:
      'IMPORTANT: Do not use this tool unless the user explicitly asks you to create a new session. ' +
      'Create a new Baguette agent session (same fields as the dashboard form). Use ListBranches for base_branch. ' +
      'Optional preset_model_id from ListPresetModels, else Settings → Agent session defaults. ' +
      'For follow-up work and stacked PRs, pass `branch` (or base_branch) set to the parent session `remote_branch` from CurrentSessionInfo so the new session branches off that head (create_new_branch defaults to true). ' +
      'Pass is_global to start a global session from the shared repos folder (omit base_branch and repo_id when is_global).',
    schema: {
      repo_id: z
        .number()
        .int()
        .optional()
        .describe('Repository id from ListRepos (required for repo sessions; omit when is_global)'),
      base_branch: z
        .string()
        .optional()
        .describe('Git branch to branch from (omit when is_global; alias: branch)'),
      branch: z
        .string()
        .optional()
        .describe(
          'Same as base_branch — preferred for stacked PR follow-ups (parent session remote_branch from CurrentSessionInfo)'
        ),
      is_global: z
        .boolean()
        .optional()
        .describe('Start a global session in the shared repos folder (no git/PR tools)'),
      initial_prompt: z.string().describe('Initial user prompt for the agent'),
      preset_model_id: z
        .number()
        .int()
        .optional()
        .describe('Preset model id from ListPresetModels'),
      create_new_branch: z
        .boolean()
        .optional()
        .describe('Create a new working branch (default true)'),
      branch_name: z.string().optional().describe('Optional new branch name'),
      auto_push: z.boolean().optional().describe('Auto-push commits (default true)'),
      plugins: z.array(z.string()).optional().describe('Plugin ids to enable'),
    },
    handler: async ({
      repo_id,
      base_branch,
      branch,
      is_global = false,
      initial_prompt,
      preset_model_id,
      create_new_branch = true,
      branch_name,
      auto_push = true,
      plugins,
    }) => {
      if (!is_global && repo_id == null) {
        return fail('repo_id is required unless is_global is true');
      }
      let resolvedBaseBranch = base_branch;
      if (!is_global) {
        const branchResolution = resolveCreateSessionBaseBranch(base_branch, branch);
        if (branchResolution.error) {
          return fail(branchResolution.error);
        }
        resolvedBaseBranch = branchResolution.base_branch;
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
      let resolved;
      try {
        resolved = await resolveMcpBuilderModel(db, userId, {
          preset_model_id: preset_model_id ?? null,
          repo_id: is_global ? null : repo_id,
        });
      } catch (err) {
        return fail(err.message);
      }

      let config;
      try {
        config = await loadOwnedAgentConfig(db, resolved.agent_config_id, userId);
      } catch (err) {
        return fail(err.message);
      }

      const agent_sdk = config.sdk;
      if (!app.service('agent-configs').getSdkMeta(agent_sdk)) {
        return fail(`Agent SDK "${agent_sdk}" is not available for this configuration.`);
      }

      let modelParams = stringifyModelParamsForStorage(resolved.model_params);
      if (!modelParams && resolved.model) {
        const prefs = parseCursorModelPrefsJson(fullUser.agent_preferences);
        try {
          const models = await loadModelsForSdk(fullUser, agent_sdk, null, app, {
            agentConfigId: resolved.agent_config_id,
          });
          let resolvedParams;
          if (agent_sdk === 'cursor') {
            resolvedParams = resolveCursorModelParams({
              models,
              modelId: resolved.model,
              modelParamsJson: undefined,
              cursorModelPrefs: prefs,
            });
          } else if (agent_sdk === 'claude') {
            resolvedParams = resolveClaudeAgentModelParams({
              models,
              modelId: resolved.model,
              modelParams: undefined,
              cursorModelPrefs: prefs,
            });
          } else if (agent_sdk === 'pi') {
            resolvedParams = resolvePiAgentModelParams({
              models,
              modelId: resolved.model,
              modelParams: undefined,
            });
          }
          modelParams = stringifyModelParamsForStorage(resolvedParams);
        } catch {
          // Model list unavailable — session still starts with model id only (no variant params).
        }
      }

      const payload = {
        initial_prompt,
        agent_config_id: resolved.agent_config_id,
        agent_sdk,
      };
      if (is_global) {
        payload.is_global = true;
      } else {
        payload.repo_full_name = repoWithKeys.full_name;
        payload.base_branch = resolvedBaseBranch;
        payload.create_new_branch = create_new_branch;
        payload.auto_push = auto_push;
      }
      payload.model = resolved.model;
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
          sessionPath: `/sessions/${session.id}`,
          message: `Session created: /sessions/${session.id}`,
        });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
