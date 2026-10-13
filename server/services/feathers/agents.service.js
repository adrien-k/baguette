import { KnexService } from '@feathersjs/knex';
import { BadRequest, NotFound } from '@feathersjs/errors';
import { requireUser, scopeBySessionUser, only } from './hooks.js';
import { getReviewAgentTurn, reviewTurnKey } from '../review-agent-turn.js';
import { loadOwnedAgentConfig } from '../agent-config-resolver.js';
import { stringifyModelParamsForStorage } from '../../../shared/agent-session-defaults.js';
import { dispatchReviewerAfterCreate } from '../reviewer-turn-prime.js';
import { getAgentById } from '../agents-db.js';

class AgentsService extends KnexService {
  setup(app) {
    this.app = app;
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
    } else {
      throw new BadRequest('Cannot stop this agent');
    }
    return { ok: true, agent_id: agent.id };
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

async function validateCreate(context) {
  const { session_id, agent_type, agent_config_id, model } = context.data;
  if (!session_id || !agent_type || agent_config_id == null) {
    throw new BadRequest('session_id, agent_type, and agent_config_id are required');
  }
  if (agent_type !== 'builder' && agent_type !== 'reviewer') {
    throw new BadRequest('agent_type must be builder or reviewer');
  }
  if (agent_type === 'reviewer' && (model == null || String(model).trim() === '')) {
    throw new BadRequest('model is required for reviewer');
  }
  const db = context.app.get('db');
  if (agent_type === 'builder') {
    const existing = await db('agents').where({ session_id, is_primary: 1 }).first();
    if (existing) throw new BadRequest('Session already has a primary builder');
  }
  if (agent_type === 'reviewer') {
    const existing = await db('agents').where({ session_id, agent_type: 'reviewer' }).first();
    if (existing) throw new BadRequest('Session already has a reviewer');
  }
  const config = await loadOwnedAgentConfig(db, Number(agent_config_id), context.params.user.id);
  context.data.agent_sdk = config.sdk;
  context.data.name = context.data.name || (agent_type === 'reviewer' ? 'Reviewer' : 'Builder');
  context.data.is_primary = agent_type === 'builder' ? 1 : 0;
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
    methods: ['find', 'get', 'create', 'patch', 'remove', 'stop'],
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
