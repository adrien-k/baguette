import { z } from 'zod';
import logger from '../../../logger.js';
import { stringifyModelParamsForStorage } from '../../../../shared/agent-session-defaults.js';
import { isGlobalSession } from '../../../../shared/session-scope.js';
import { getSdkPlugin } from '../../../agent-sdks/registry.js';
import { ensureBuiltInSdkPluginsRegistered } from '../../../agent-sdks/ensure-builtins-registered.js';
import { loadModelsForSdk } from '../../baguette-models-for-user.js';
import { loadOwnedAgentConfig } from '../../agent-config-resolver.js';
import { normalizeSubagentDefaultMode } from '../../../../shared/subagent-default-mode.js';
import { resolveMcpBuilderModel } from '../../agent-mcp-model-resolver.js';
import { getPrimaryBuilderAgent, insertAgentObserver } from '../../agents-db.js';
import {
  agentCreatedModelClause,
  agentCreatedModelSchemaFields,
} from '../lib/agent-created-model-fields.js';
import { ok, fail } from '../lib/result.js';
import { createGlobalSessionModelResolver } from '../../slack-global-session-model.js';
import { isRepoInSlackScope } from '../../slack-repo-scope.js';

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

function createSessionDescription(mode) {
  return (
    'IMPORTANT: Do not use this tool unless the user explicitly asks you to create a new session. ' +
    'Create a new Baguette agent session (same fields as the dashboard form). Use ListBranches for base_branch. ' +
    `${agentCreatedModelClause(mode, 'session')} ` +
    'For follow-up work and stacked PRs, pass `branch` (or base_branch) set to the parent session `remote_branch` from CurrentSessionInfo so the new session branches off that head (create_new_branch defaults to true). ' +
    'Pass is_global to start a global session from the shared repos folder (omit base_branch and repo_id when is_global). ' +
    'For orchestration: pass notify_parent: true to get a wake-up message each time the new session’s builder turn finishes (completed/failed) or waits for user input — then end your turn instead of blocking. ' +
    'Only global sessions may observe the sessions they create; a repo session must create children without notify_parent.'
  );
}

export function createCreateSessionTool(ctx) {
  const {
    app,
    userId,
    userParams,
    user,
    requireRepoAccess,
    loadRepoWithKeys,
    callerSession,
    callerAgent,
  } = ctx;
  const mode = normalizeSubagentDefaultMode(user?.subagent_default_mode);
  // Slack global sessions (and their callers) may fall back to Haiku or Composer when the owner
  // has no default model.
  const resolveBuilderModel =
    ctx.resolveBuilderModel ??
    (callerSession?.slack_app_id ? createGlobalSessionModelResolver(app) : resolveMcpBuilderModel);
  return {
    name: 'CreateSession',
    description: createSessionDescription(mode),
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
      ...agentCreatedModelSchemaFields(mode),
      create_new_branch: z
        .boolean()
        .optional()
        .describe('Create a new working branch (default true)'),
      branch_name: z.string().optional().describe('Optional new branch name'),
      auto_push: z.boolean().optional().describe('Auto-push commits (default true)'),
      plugins: z.array(z.string()).optional().describe('Plugin ids to enable'),
      is_shared: z
        .boolean()
        .optional()
        .describe('When true, every authenticated user on this instance can open the session'),
      notify_parent: z
        .boolean()
        .optional()
        .describe(
          'When true, subscribe this agent to the new session’s turn-end notifications (wake-up messages on completed/failed turns and on approval). Only global sessions may observe the sessions they create — a repo session must pass false. Prefer ending your turn right after creating; use UnwatchSession to stop notifications.'
        ),
    },
    handler: async ({
      repo_id,
      base_branch,
      branch,
      is_global = false,
      initial_prompt,
      preset_model_id,
      agent_config_id,
      model,
      model_params,
      create_new_branch = true,
      branch_name,
      auto_push = true,
      plugins,
      is_shared,
      notify_parent = false,
    }) => {
      if (!is_global && repo_id == null) {
        return fail('repo_id is required unless is_global is true');
      }
      if (notify_parent && (callerSession?.id == null || callerAgent?.id == null)) {
        return fail(
          'notify_parent requires an in-session agent (caller session and agent); external MCP callers cannot receive wake-ups.'
        );
      }
      if (notify_parent && !isGlobalSession(callerSession)) {
        return fail(
          'Only global sessions can observe the sessions they create — a repo session cannot watch its children. ' +
            'Create the session without notify_parent, or run the orchestration from a global session.'
        );
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
        if (!(await isRepoInSlackScope(app, callerSession, repo_id))) {
          return fail(
            `Repository ${repo_id} is outside what this Slack global session may work in.`
          );
        }
        repoWithKeys = (await loadRepoWithKeys(repo_id)) ?? {
          id: access.id,
          full_name: access.full_name,
        };
      }

      const db = app.get('db');
      let resolved;
      try {
        resolved = await resolveBuilderModel(db, userId, {
          preset_model_id: preset_model_id ?? null,
          agent_config_id: agent_config_id ?? null,
          model: model ?? null,
          model_params: model_params ?? null,
          repo_id: is_global ? null : repo_id,
          app,
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
        await ensureBuiltInSdkPluginsRegistered();
        const plugin = getSdkPlugin(agent_sdk);
        try {
          const models = await loadModelsForSdk(fullUser, agent_sdk, null, app, {
            agentConfigId: resolved.agent_config_id,
          });
          const resolvedParams = plugin?.resolveModelParams?.({
            models,
            modelId: resolved.model,
            user: fullUser,
          });
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
      if (is_shared) payload.is_shared = true;
      if (ctx.slackAppId) payload.slack_app_id = ctx.slackAppId;

      try {
        const session = await app.service('sessions').create(payload, {
          ...userParams,
          user: fullUser,
          // Set when the session is created for a chat integration (Slack): what the first
          // message is labelled in the chat, and a fixed title that saves the naming LLM call.
          ...(ctx.initialMessageMeta ? { initialMessageMeta: ctx.initialMessageMeta } : {}),
          ...(ctx.initialLabel ? { initialLabel: ctx.initialLabel } : {}),
        });
        const message = `Session created: /sessions/${session.id}`;
        if (notify_parent) {
          // Atomic spawn+watch: insert the caller's observer row right after create so
          // the session's first turn can never finish before the subscription exists.
          try {
            const db = app.get('db');
            const observed = await getPrimaryBuilderAgent(db, session.id);
            if (observed) {
              await insertAgentObserver(db, {
                agentId: observed.id,
                observerAgentId: callerAgent.id,
              });
            }
          } catch (err) {
            logger.warn(
              { sessionId: session.id, callerAgentId: callerAgent?.id, err: err?.message },
              'Failed to insert CreateSession notify_parent observer row'
            );
            return ok({
              sessionId: session.id,
              sessionPath: `/sessions/${session.id}`,
              message: `${message} Warning: turn-end notifications could not be armed (re-arm with WatchSession).`,
            });
          }
        }
        return ok({
          sessionId: session.id,
          sessionPath: `/sessions/${session.id}`,
          message,
        });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
