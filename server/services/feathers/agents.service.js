import { KnexService } from '@feathersjs/knex';
import { BadRequest, NotFound } from 'feathers/errors';
import logger from '../../logger.js';
import { requireUser, scopeBySessionUser, only } from './hooks.js';
import { getReviewAgentTurn, reviewTurnKey } from '../review-agent-turn.js';
import { loadOwnedAgentConfig } from '../agent-config-resolver.js';
import { stringifyModelParamsForStorage } from '../../../shared/agent-session-defaults.js';
import { dispatchReviewerAfterCreate } from '../reviewer-turn-prime.js';
import {
  builderChatActiveKey,
  getAgentById,
  listActiveChildAgents,
  listSubagentsForSession,
} from '../agents-db.js';
import { getAgentServiceForAgent, getAgentServiceForSession } from '../agent-session-routing.js';
import { getUtilityModelService } from '../utility-model.js';
import { completeSessionMetadata } from '../session-metadata.js';
import { setAgentTurnTerminal } from '../agent-turn-patch.js';
import { resolveMcpStartSubagentModel } from '../agent-mcp-model-resolver.js';
import { waitForAgentTurnEnd } from '../wait-for-agent-turn.js';
import { insertAgentObserver, notifyParentAgentIds } from '../agents-db.js';
import {
  buildMcpUserMessageJson,
  summarizeAssistantMessage,
} from '../mcp/lib/session-resolution.js';
import { resolveMcpMessageSenderForParentAgent } from '../mcp/lib/mcp-message-sender.js';
import { agentFailureError, hydrateAgentFailureErrors } from '../agent-error-message.js';
import { nextSessionItemRef } from '../session-item-ref.js';
import { titleFromPrompt } from '../../../shared/agent-naming.js';
import {
  assertIsolatedWorktreeAllowed,
  provisionIsolatedSubagentWorktree,
  subagentWorktreePayload,
  killTasksUnderSubagentWorktrees,
  teardownIsolatedSubagentWorktree,
} from '../subagent-worktree.js';

async function resolveStartSubagentParentId(db, sessionId, parentAgentId) {
  if (parentAgentId == null || parentAgentId === '') return null;
  const id = Number(parentAgentId);
  if (!Number.isFinite(id)) throw new BadRequest('Invalid parent_agent_id');
  const parent = await getAgentById(db, id);
  if (!parent || parent.session_id !== sessionId) {
    throw new BadRequest('parent_agent_id not found in session');
  }
  if (parent.agent_type === 'reviewer') {
    throw new BadRequest('Cannot attach subagent to reviewer parent');
  }
  return id;
}

async function subagentTurnResult(app, sessionId, agentId) {
  const db = app.get('db');
  const agent = await getAgentById(db, agentId);
  await hydrateAgentFailureErrors(db, [agent]);
  const lastAssistant = await db('session_messages')
    .where({ session_id: sessionId, agent_id: agentId, type: 'assistant' })
    .orderBy('id', 'desc')
    .first();
  return {
    agent_id: agent.id,
    ref: agent.ref,
    status: agent.status,
    error_message: agentFailureError(agent),
    session_id: sessionId,
    last_assistant_message: summarizeAssistantMessage(lastAssistant),
    ...subagentWorktreePayload(agent),
  };
}

function isAgentsRefUniqueViolation(err) {
  const msg = String(err?.message ?? '');
  return (
    msg.includes('agents_session_id_ref_idx') || msg.includes('UNIQUE constraint failed: agents')
  );
}

class AgentsService extends KnexService {
  setup(app) {
    this.app = app;
  }

  async create(data, params) {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const payload = attempt === 0 ? data : { ...data, ref: undefined };
        return await super.create(payload, params);
      } catch (err) {
        if (attempt < maxAttempts - 1 && isAgentsRefUniqueViolation(err)) {
          continue;
        }
        throw err;
      }
    }
    throw new BadRequest('Failed to allocate agent ref');
  }

  async stop(data, params) {
    const agentId = Number(data?.agent_id);
    if (!Number.isFinite(agentId)) throw new BadRequest('agent_id is required');
    const agent = await this.get(agentId, { user: params.user });
    await this._stopActiveChildAgents(agent, params);
    await this._stopSingleAgent(agent, params);
    return { ok: true, agent_id: agent.id };
  }

  async _stopActiveChildAgents(agent, params) {
    const db = this.app.get('db');
    const children = await listActiveChildAgents(db, agent.id);
    for (const child of children) {
      await this._stopActiveChildAgents(child, params);
      await this._stopSingleAgent(child, params);
    }
  }

  async _stopSingleAgent(agent, params) {
    const session = await this.app.service('sessions').get(agent.session_id, { user: params.user });
    const reviewTurn = getReviewAgentTurn(this.app);
    if (agent.agent_type === 'reviewer') {
      await reviewTurn.stopReviewerAgent(session, agent);
    } else if (agent.agent_type === 'builder' || agent.agent_type === 'subagent') {
      const agentService = await getAgentServiceForAgent(this.app, agent);
      const activeKey = builderChatActiveKey(agent);
      if (typeof agentService.stopTurn === 'function') {
        await agentService.stopTurn(activeKey);
      } else if (typeof agentService.stopSession === 'function') {
        await agentService.stopSession(activeKey);
      }
      await setAgentTurnTerminal(this.app, agent, session.user_id, 'stopped');
    } else {
      throw new BadRequest('Cannot stop this agent');
    }
  }

  /**
   * Generate a short agent label from a prompt. Prefers the account utility model;
   * otherwise uses the session's primary builder. Throws when nothing usable comes back
   * so the client can keep the heuristic prefill.
   */
  async generateName(data, params) {
    const prompt = String(data?.prompt ?? '').trim();
    const sessionId = Number(data?.session_id);
    if (!prompt) throw new BadRequest('prompt is required');
    if (!Number.isFinite(sessionId)) throw new BadRequest('session_id is required');
    const session = await this.app.service('sessions').get(sessionId, { user: params.user });

    let name = await completeUtilityAgentName(this.app, params.user, prompt);
    if (!name) {
      try {
        const builderService = await getAgentServiceForSession(this.app, session);
        const builder = await this.app
          .get('db')('agents')
          .where({ session_id: sessionId, is_primary: 1 })
          .first();
        name = await labelFromMetadataService(builderService, {
          taskPrompt: prompt,
          userId: params.user?.id ?? null,
          agentConfigId: builder?.agent_config_id ?? session.agent_config_id ?? null,
          model: builder?.model ?? session.model ?? null,
          modelParams: builder?.model_params ?? session.model_params ?? null,
        });
      } catch (err) {
        logger.warn({ err: err?.message }, 'Session builder name generation failed');
      }
    }
    if (!name) throw new BadRequest('Could not generate a label');
    return { name };
  }

  async startSubagent(data, params) {
    const sessionId = Number(data?.session_id);
    const name = data?.name != null ? String(data.name).trim() : '';
    const initialPrompt = data?.initial_prompt != null ? String(data.initial_prompt).trim() : '';
    if (!Number.isFinite(sessionId)) throw new BadRequest('session_id is required');
    if (!name) throw new BadRequest('name is required');
    if (!initialPrompt) throw new BadRequest('initial_prompt is required');

    const waitForCompletion = data.wait_for_completion !== false;
    const notifyParent = data.notify_parent === true;
    const isolatedWorktree = data.isolated_worktree === true;

    const session = await this.app.service('sessions').get(sessionId, { user: params.user });
    if (isolatedWorktree) {
      assertIsolatedWorktreeAllowed(session);
    }
    const db = this.app.get('db');
    const repo =
      session.repo_id != null ? await db('repos').where({ id: session.repo_id }).first() : null;
    const parentAgentId = await resolveStartSubagentParentId(
      db,
      sessionId,
      data.parent_agent_id ?? null
    );
    const resolved = await resolveMcpStartSubagentModel(db, params.user.id, {
      session_id: sessionId,
      preset_model_id: data.preset_model_id ?? null,
      agent_config_id: data.agent_config_id ?? null,
      model: data.model ?? null,
      model_params: data.model_params ?? null,
      repo_id: session.repo_id ?? null,
      app: this.app,
    });

    const modelParamsStored = stringifyModelParamsForStorage(resolved.model_params);

    const agent = await this.create(
      {
        session_id: sessionId,
        agent_type: 'subagent',
        name,
        agent_config_id: resolved.agent_config_id,
        model: resolved.model,
        model_params: modelParamsStored,
        initial_prompt: initialPrompt,
        ...(parentAgentId != null ? { parent_agent_id: parentAgentId } : {}),
      },
      { ...params, provider: 'rest' }
    );

    let worktreeMeta = null;
    if (isolatedWorktree) {
      try {
        worktreeMeta = await provisionIsolatedSubagentWorktree(session, repo, agent.id);
        await this.patch(
          agent.id,
          {
            worktree_path: worktreeMeta.worktree_path_stored,
            local_branch: worktreeMeta.local_branch,
          },
          { user: params.user, provider: undefined }
        );
      } catch (err) {
        if (worktreeMeta) {
          await teardownIsolatedSubagentWorktree(repo, {
            worktree_path: worktreeMeta.worktree_path_stored,
            local_branch: worktreeMeta.local_branch,
          });
        }
        await this.remove(agent.id, { user: params.user, provider: undefined });
        throw err;
      }
    }

    // Observer row must exist before the first message dispatches the turn — a very
    // fast turn would otherwise go terminal before the wake-up subscription lands.
    if (notifyParent && parentAgentId != null) {
      try {
        await insertAgentObserver(this.app.get('db'), {
          agentId: agent.id,
          observerAgentId: parentAgentId,
        });
      } catch (err) {
        logger.warn(
          { agentId: agent.id, parentAgentId, err: err?.message },
          'Failed to insert subagent notify_parent observer row'
        );
      }
    }

    const mcpSender = await resolveMcpMessageSenderForParentAgent(db, sessionId, parentAgentId);
    const message_json = buildMcpUserMessageJson(initialPrompt, mcpSender);

    try {
      await this.app.service('messages').create(
        {
          session_id: sessionId,
          type: 'user',
          subtype: 'mcp',
          message_json,
          agent_id: agent.id,
          agent_sdk: resolved.agent_sdk,
          model: resolved.model,
          ...(modelParamsStored != null ? { model_params: modelParamsStored } : {}),
          agent_config_id: resolved.agent_config_id,
        },
        { user: params.user, provider: 'rest' }
      );
    } catch (err) {
      if (worktreeMeta) {
        await teardownIsolatedSubagentWorktree(repo, {
          worktree_path: worktreeMeta.worktree_path_stored,
          local_branch: worktreeMeta.local_branch,
        });
      }
      await this.remove(agent.id, { user: params.user, provider: undefined });
      throw err;
    }

    if (!waitForCompletion) {
      const fresh = await getAgentById(this.app.get('db'), agent.id);
      const watching = await notifyParentAgentIds(this.app.get('db'), [agent.id]);
      return {
        agent_id: agent.id,
        ref: agent.ref,
        status: fresh?.status ?? agent.status,
        session_id: sessionId,
        notify_parent: watching.has(agent.id),
        ...subagentWorktreePayload(fresh ?? agent),
      };
    }

    await waitForAgentTurnEnd(this.app.get('db'), agent.id);
    return subagentTurnResult(this.app, sessionId, agent.id);
  }

  async awaitSubagent(data, params) {
    const sessionId = Number(data?.session_id);
    if (!Number.isFinite(sessionId)) throw new BadRequest('session_id is required');
    await this.app.service('sessions').get(sessionId, { user: params.user });
    const db = this.app.get('db');
    const agent = await this._resolveSubagentTarget(db, sessionId, data);
    if (agent.status === 'running') {
      await waitForAgentTurnEnd(db, agent.id);
    }
    return subagentTurnResult(this.app, sessionId, agent.id);
  }

  async _resolveSubagentTarget(db, sessionId, data) {
    const agentId = data?.agent_id != null ? Number(data.agent_id) : null;
    const agentRef = data?.agent_ref != null ? Number(data.agent_ref) : null;
    if (!Number.isFinite(agentId) && !Number.isFinite(agentRef)) {
      throw new BadRequest('agent_id or agent_ref is required');
    }
    let agent = null;
    if (Number.isFinite(agentId)) {
      agent = await getAgentById(db, agentId);
    } else {
      agent = await db('agents').where({ session_id: sessionId, ref: agentRef }).first();
    }
    if (!agent || agent.session_id !== sessionId || agent.agent_type !== 'subagent') {
      throw new NotFound('Subagent not found');
    }
    return agent;
  }

  async listSubagents(data, params) {
    const sessionId = Number(data?.session_id);
    if (!Number.isFinite(sessionId)) throw new BadRequest('session_id is required');
    await this.app.service('sessions').get(sessionId, { user: params.user });
    const rows = await listSubagentsForSession(this.app.get('db'), sessionId, {
      status: data?.status,
      active_only: data?.active_only === true,
    });
    const watching = await notifyParentAgentIds(
      this.app.get('db'),
      rows.map((row) => row.id)
    );
    await hydrateAgentFailureErrors(this.app.get('db'), rows);
    return {
      session_id: sessionId,
      subagents: rows.map((row) => ({
        agent_id: row.id,
        ref: row.ref,
        name: row.name,
        status: row.status,
        error_message: agentFailureError(row),
        parent_agent_id: row.parent_agent_id ?? null,
        notify_parent: watching.has(row.id),
        ...subagentWorktreePayload(row),
      })),
    };
  }
}

const EXTERNAL_PATCH_FIELDS = [
  'name',
  'agent_config_id',
  'model',
  'model_params',
  'initial_prompt',
];

/** Bump `updated_at` on every non-empty agent patch (sidebar "last activity" label). */
function touchUpdatedAt(context) {
  if (!context.data || Object.keys(context.data).length === 0) return context;
  context.data.updated_at = new Date().toISOString();
  return context;
}

const CREATE_FIELDS = [
  'session_id',
  'agent_type',
  'agent_config_id',
  'model',
  'model_params',
  'initial_prompt',
  'name',
  'parent_agent_id',
  // Naming-only hint for secondary builders; consumed by resolveSecondaryBuilderName.
  'naming_prompt',
];

const AGENT_NAME_MAX_LENGTH = 120;

async function labelFromMetadataService(service, opts) {
  const { label } = await completeSessionMetadata(service, opts);
  return label.slice(0, AGENT_NAME_MAX_LENGTH);
}

/**
 * Ask the account utility model for a short agent name. Returns '' when none is
 * configured or the completion is unusable; callers apply their own fallback.
 */
async function completeUtilityAgentName(app, user, prompt) {
  const trimmed = String(prompt ?? '').trim();
  if (!trimmed) return '';
  try {
    const utility = await getUtilityModelService(app, user?.id);
    if (!utility) return '';
    return await labelFromMetadataService(utility.service, {
      taskPrompt: trimmed,
      userId: user?.id ?? null,
      agentConfigId: utility.agent_config_id,
      model: utility.model,
      modelParams: utility.model_params,
    });
  } catch (err) {
    logger.warn({ err: err?.message }, 'Utility model name generation failed');
    return '';
  }
}

/**
 * Name a manually started secondary builder when the caller does not pass a name:
 * the user's utility model (Settings → Agent) summarizes `naming_prompt`, falling back
 * to the prompt's first words, then 'Builder'. The hint is never persisted.
 */
async function resolveSecondaryBuilderName(context) {
  if (context.method !== 'create') return context;
  const data = context.data ?? {};
  const namingPrompt = typeof data.naming_prompt === 'string' ? data.naming_prompt : '';
  delete data.naming_prompt;
  if (data.agent_type !== 'builder') return context;
  if (typeof data.name === 'string' && data.name.trim()) return context;
  const sessionId = data.session_id;
  if (!sessionId) return context;
  const primary = await context.app
    .get('db')('agents')
    .where({ session_id: sessionId, is_primary: 1 })
    .first();
  if (!primary) return context; // first builder keeps the default naming
  const prompt = namingPrompt.trim();
  const name = prompt
    ? await completeUtilityAgentName(context.app, context.params.user, prompt)
    : '';
  context.data.name = name || titleFromPrompt(prompt);
  return context;
}

async function stashReviewerCreateExtras(context) {
  if (!context.params?.provider) return context;
  if (context.data?.extra_prompt !== undefined) {
    context.params._reviewerCreateExtras = { extra_prompt: context.data.extra_prompt };
    delete context.data.extra_prompt;
  }
  return context;
}

async function normalizeModelParams(context) {
  if (context.data?.model_params !== undefined) {
    context.data.model_params = stringifyModelParamsForStorage(context.data.model_params);
  }
  return context;
}

async function resolveSdkOnConfigChange(context) {
  if (!context.data?.agent_config_id || !context.params.user?.id) return context;
  const config = await loadOwnedAgentConfig(
    context.app.get('db'),
    Number(context.data.agent_config_id),
    context.params.user.id
  );
  context.data.agent_sdk = config.sdk;
  return context;
}

async function pickCreateFields(context) {
  if (!context.params?.provider) return context;
  const picked = {};
  for (const key of CREATE_FIELDS) {
    if (context.data[key] !== undefined) picked[key] = context.data[key];
  }
  context.data = picked;
  return context;
}

async function allocateAgentRef(context) {
  if (context.method !== 'create' || context.data?.ref != null) return context;
  const sessionId = context.data?.session_id;
  if (!sessionId) return context;
  context.data.ref = await nextSessionItemRef(context.app.get('db'), 'agents', sessionId);
  return context;
}

/** Extra builders default to the primary builder's config, model, and params. */
async function inheritPrimaryBuilderDefaults(context) {
  const agentType = context.data?.agent_type;
  if (context.method !== 'create' || (agentType !== 'builder' && agentType !== 'subagent')) {
    return context;
  }
  const sessionId = context.data?.session_id;
  if (!sessionId) return context;
  const db = context.app.get('db');
  const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
  if (!primary) return context;
  if (context.data.agent_config_id == null) {
    context.data.agent_config_id = primary.agent_config_id;
  }
  if (context.data.model == null || String(context.data.model).trim() === '') {
    context.data.model = primary.model;
  }
  if (context.data.model_params === undefined) {
    context.data.model_params = primary.model_params;
  }
  return context;
}

async function validateCreate(context) {
  const { session_id, agent_type, agent_config_id, model } = context.data;
  if (!session_id || !agent_type || agent_config_id == null) {
    throw new BadRequest('session_id, agent_type, and agent_config_id are required');
  }
  if (agent_type !== 'builder' && agent_type !== 'reviewer' && agent_type !== 'subagent') {
    throw new BadRequest('agent_type must be builder, reviewer, or subagent');
  }
  if (agent_type === 'reviewer' && (model == null || String(model).trim() === '')) {
    throw new BadRequest('model is required for reviewer');
  }
  const db = context.app.get('db');
  if (agent_type === 'subagent') {
    const name = context.data.name?.trim();
    if (!name) throw new BadRequest('name is required for a subagent');
    context.data.is_primary = 0;
    // Parent wake-ups are `agent_observers` rows created by StartSubagent (notify_parent).
    delete context.data.notify_parent;
    if (context.data.parent_agent_id != null) {
      context.data.parent_agent_id = await resolveStartSubagentParentId(
        db,
        session_id,
        context.data.parent_agent_id
      );
    }
  } else {
    delete context.data.parent_agent_id;
    delete context.data.notify_parent;
  }
  if (agent_type === 'builder') {
    const existingPrimary = await db('agents').where({ session_id, is_primary: 1 }).first();
    // Secondary builders are named by resolveSecondaryBuilderName before this hook.
    context.data.is_primary = existingPrimary ? 0 : 1;
  }
  if (agent_type === 'reviewer') {
    const existing = await db('agents').where({ session_id, agent_type: 'reviewer' }).first();
    if (existing) throw new BadRequest('Session already has a reviewer');
  }
  const config = await loadOwnedAgentConfig(db, Number(agent_config_id), context.params.user.id);
  context.data.agent_sdk = config.sdk;
  if (!context.data.name) {
    if (agent_type === 'reviewer') {
      context.data.name = 'Reviewer';
    } else if (agent_type === 'subagent') {
      context.data.name = 'Subagent';
    } else {
      context.data.name = 'Builder';
    }
  }
  if (agent_type === 'reviewer') {
    context.data.is_primary = 0;
  }
  context.data.status = context.data.status ?? 'stopped';
  context.data.current_turn_id = 0;
  if (context.data.initial_prompt != null && typeof context.data.initial_prompt === 'string') {
    const trimmed = context.data.initial_prompt.trim();
    context.data.initial_prompt = trimmed || null;
  }
  return context;
}

async function afterReviewerCreate(context) {
  const agent = context.result;
  if (!agent || agent.agent_type !== 'reviewer' || !context.params?.provider) return context;
  const session = await context.app.get('db')('sessions').where({ id: agent.session_id }).first();
  if (!session) throw new NotFound('Session not found');
  try {
    await dispatchReviewerAfterCreate(
      context.app,
      agent,
      session,
      {
        ...(context.data ?? {}),
        ...(context.params._reviewerCreateExtras ?? {}),
      },
      context.params.user
    );
  } catch (err) {
    await context.app.service('agents').remove(agent.id, {
      provider: undefined,
      user: context.params.user,
    });
    throw err;
  }
  context.result = await context.service.get(agent.id, { user: context.params.user });
  return context;
}

async function stopReviewerBeforeRemove(app, row, user) {
  if (row.agent_type !== 'reviewer') return;
  if (row.status !== 'running' && row.status !== 'approval') return;
  const session = await app.service('sessions').get(row.session_id, { user });
  await getReviewAgentTurn(app).stopReviewerAgent(session, row);
}

/** External name changes are limited to extra builders (not primary, reviewer, or MCP subagent). */
async function restrictNamePatch(context) {
  if (!context.params?.provider) return context;
  if (context.data?.name === undefined) return context;
  const agent = await getAgentById(context.app.get('db'), context.id);
  if (!agent) throw new NotFound('Agent not found');
  if (agent.agent_type !== 'builder' || Number(agent.is_primary) === 1) {
    throw new BadRequest('Only secondary builders can be renamed');
  }
  return context;
}

/** Collaborators may stop a run; only the owner can create, reconfigure, or delete agents. */
async function requireOwnSessionForWrite(context) {
  if (!context.params?.provider) return context;
  const userId = context.params.user?.id;
  if (!userId) return context;
  const db = context.app.get('db');
  let sessionId = context.data?.session_id;
  if (context.id != null) {
    const agent = await getAgentById(db, context.id);
    if (!agent) throw new NotFound('Agent not found');
    sessionId = agent.session_id;
  }
  if (sessionId == null) return context;
  const session = await db('sessions').where({ id: sessionId, user_id: userId }).first();
  if (!session) throw new NotFound('Session not found');
  return context;
}

async function beforeRemove(context) {
  const row = await context.service.get(context.id, { user: context.params.user });
  if (!row) throw new NotFound('Agent not found');
  if (row.is_primary) throw new BadRequest('Cannot remove the primary builder');
  await stopReviewerBeforeRemove(context.app, row, context.params.user);
  const fresh = await getAgentById(context.app.get('db'), row.id);
  if (fresh?.status === 'running' || fresh?.status === 'approval') {
    throw new BadRequest('Could not stop agent before removal');
  }
  const db = context.app.get('db');
  if (row.worktree_path) {
    const session = await db('sessions').where({ id: row.session_id }).first();
    const repo =
      session?.repo_id != null ? await db('repos').where({ id: session.repo_id }).first() : null;
    await killTasksUnderSubagentWorktrees(context.app, row.session_id, [row]);
    await teardownIsolatedSubagentWorktree(repo, {
      worktree_path: row.worktree_path,
      local_branch: row.local_branch,
    });
  }
  if (row.agent_type === 'reviewer') {
    context.app.service('sessions').resetUsageTotals(reviewTurnKey(row.id));
  }
  await db('session_messages').where({ agent_id: row.id }).delete();
  await db('queued_messages').where({ agent_id: row.id }).delete();
  await db('usage').where({ agent_id: row.id }).update({ agent_id: null });
  return context;
}

const agentsHooks = {
  before: {
    all: [requireUser, scopeBySessionUser],
    find: [],
    get: [],
    create: [
      requireOwnSessionForWrite,
      pickCreateFields,
      resolveSecondaryBuilderName,
      stashReviewerCreateExtras,
      allocateAgentRef,
      inheritPrimaryBuilderDefaults,
      validateCreate,
      normalizeModelParams,
      resolveSdkOnConfigChange,
    ],
    patch: [
      requireOwnSessionForWrite,
      only(EXTERNAL_PATCH_FIELDS),
      restrictNamePatch,
      normalizeModelParams,
      resolveSdkOnConfigChange,
      touchUpdatedAt,
    ],
    remove: [requireOwnSessionForWrite, beforeRemove],
    stop: [requireUser],
  },
  after: {
    create: [afterReviewerCreate],
  },
};

export function registerAgentsService(app, path = 'agents') {
  const options = {
    Model: app.get('db'),
    name: 'agents',
    id: 'id',
    paginate: { default: 50, max: 100 },
  };
  app.use(path, new AgentsService(options), {
    methods: [
      'find',
      'get',
      'create',
      'patch',
      'remove',
      'stop',
      'generateName',
      'startSubagent',
      'awaitSubagent',
      'listSubagents',
    ],
  });
  app.service(path).hooks(agentsHooks);
}

/** Internal patch (status, SDK ids, turn counters). */
export async function patchAgentInternal(app, agentId, data, userId) {
  return app.service('agents').patch(agentId, data, {
    provider: undefined,
    user: userId != null ? { id: userId } : undefined,
  });
}
