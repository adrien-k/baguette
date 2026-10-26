import { KnexService } from '@feathersjs/knex';
import { BadRequest, NotFound } from 'feathers/errors';
import { requireUser, scopeBySessionUser, only } from './hooks.js';
import { getReviewAgentTurn, reviewTurnKey } from '../review-agent-turn.js';
import { loadOwnedAgentConfig } from '../agent-config-resolver.js';
import { stringifyModelParamsForStorage } from '../../../shared/agent-session-defaults.js';
import { dispatchReviewerAfterCreate } from '../reviewer-turn-prime.js';
import { builderChatActiveKey, getAgentById } from '../agents-db.js';
import { getAgentServiceForAgent } from '../agent-session-routing.js';
import { setAgentTurnTerminal } from '../agent-turn-patch.js';
import { resolveMcpStartSubagentModel } from '../agent-mcp-model-resolver.js';
import { waitForAgentTurnEnd } from '../wait-for-agent-turn.js';
import {
  buildMcpUserMessageJson,
  summarizeAssistantMessage,
} from '../mcp/lib/session-resolution.js';
import { nextSessionItemRef } from '../session-item-ref.js';

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
    const session = await this.app.service('sessions').get(agent.session_id, { user: params.user });
    const reviewTurn = getReviewAgentTurn(this.app);
    if (agent.agent_type === 'reviewer') {
      await reviewTurn.stopReviewerAgent(session, agent);
    } else if (agent.is_primary) {
      await this.app
        .service('sessions')
        .stop({ id: session.id }, { ...params, resolvedSession: session });
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
    return { ok: true, agent_id: agent.id };
  }

  async startSubagent(data, params) {
    const sessionId = Number(data?.session_id);
    const name = data?.name != null ? String(data.name).trim() : '';
    const initialPrompt = data?.initial_prompt != null ? String(data.initial_prompt).trim() : '';
    if (!Number.isFinite(sessionId)) throw new BadRequest('session_id is required');
    if (!name) throw new BadRequest('name is required');
    if (!initialPrompt) throw new BadRequest('initial_prompt is required');

    const session = await this.app.service('sessions').get(sessionId, { user: params.user });
    const resolved = await resolveMcpStartSubagentModel(this.app.get('db'), params.user.id, {
      session_id: sessionId,
      preset_model_id: data.preset_model_id ?? null,
      repo_id: session.repo_id ?? null,
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
      },
      { ...params, provider: 'rest' }
    );

    const message_json = buildMcpUserMessageJson(initialPrompt);

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
      await this.remove(agent.id, { user: params.user, provider: undefined });
      throw err;
    }

    const waitForCompletion = data.wait_for_completion !== false;
    if (!waitForCompletion) {
      const fresh = await getAgentById(this.app.get('db'), agent.id);
      return {
        agent_id: agent.id,
        ref: agent.ref,
        status: fresh?.status ?? agent.status,
        session_id: sessionId,
      };
    }

    const finalAgent = await waitForAgentTurnEnd(this.app.get('db'), agent.id);
    const lastAssistant = await this.app
      .get('db')('session_messages')
      .where({ session_id: sessionId, agent_id: agent.id, type: 'assistant' })
      .orderBy('id', 'desc')
      .first();

    return {
      agent_id: finalAgent.id,
      ref: finalAgent.ref,
      status: finalAgent.status,
      session_id: sessionId,
      last_assistant_message: summarizeAssistantMessage(lastAssistant),
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

const CREATE_FIELDS = [
  'session_id',
  'agent_type',
  'agent_config_id',
  'model',
  'model_params',
  'initial_prompt',
  'name',
];

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
  } else if (agent_type === 'builder') {
    const existingPrimary = await db('agents').where({ session_id, is_primary: 1 }).first();
    if (existingPrimary) {
      const name = context.data.name?.trim();
      if (!name) throw new BadRequest('name is required for an additional builder agent');
      context.data.is_primary = 0;
    } else {
      context.data.is_primary = 1;
    }
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
  if (row.agent_type === 'reviewer') {
    context.app.service('sessions').resetClaudeUsageTotals(reviewTurnKey(row.id));
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
      pickCreateFields,
      stashReviewerCreateExtras,
      allocateAgentRef,
      inheritPrimaryBuilderDefaults,
      validateCreate,
      normalizeModelParams,
      resolveSdkOnConfigChange,
    ],
    patch: [only(EXTERNAL_PATCH_FIELDS), normalizeModelParams, resolveSdkOnConfigChange],
    remove: [beforeRemove],
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
    methods: ['find', 'get', 'create', 'patch', 'remove', 'stop', 'startSubagent'],
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
