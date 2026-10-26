import { KnexService } from '@feathersjs/knex';
import { BadRequest, Forbidden, NotFound } from 'feathers/errors';
import { requireUser, scopeByUser, only } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { loadOwnedAgentConfig } from '../agent-config-resolver.js';
import {
  coerceModelParams,
  stringifyModelParamsForStorage,
} from '../../../shared/agent-session-defaults.js';

class AgentModelPresetsService extends KnexService {}

function validatePresetFields(data) {
  const description = data.description != null ? String(data.description).trim() : '';
  if (!description) throw new BadRequest('description is required');
  data.description = description;

  const model = data.model != null ? String(data.model).trim() : '';
  if (!model) throw new BadRequest('model is required');
  data.model = model;

  if (data.agent_config_id == null) {
    throw new BadRequest('agent_config_id is required');
  }
}

async function normalizeModelParams(context) {
  if (context.data?.model_params !== undefined) {
    context.data.model_params = stringifyModelParamsForStorage(context.data.model_params);
  }
  return context;
}

async function assertOwnedConfig(context) {
  const userId = context.params.user?.id;
  if (!userId) return context;
  const configId = Number(context.data?.agent_config_id);
  if (!Number.isFinite(configId)) throw new BadRequest('agent_config_id is required');
  await loadOwnedAgentConfig(context.app.get('db'), configId, userId);
  return context;
}

async function attachAgentSdkToResult(context) {
  const db = context.app.get('db');
  const enrich = async (row) => {
    if (!row) return row;
    const config = await db('agent_configs').where({ id: row.agent_config_id }).first();
    return {
      ...row,
      agent_sdk: config?.sdk ?? null,
      model_params: coerceModelParams(row.model_params),
    };
  };

  if (context.result?.data) {
    context.result.data = await Promise.all(context.result.data.map(enrich));
  } else if (Array.isArray(context.result)) {
    context.result = await Promise.all(context.result.map(enrich));
  } else if (context.result) {
    context.result = await enrich(context.result);
  }
  return context;
}

async function beforeCreate(context) {
  validatePresetFields(context.data);
  return context;
}

async function beforePatch(context) {
  if (context.data.description !== undefined) {
    const description = String(context.data.description).trim();
    if (!description) throw new BadRequest('description is required');
    context.data.description = description;
  }
  if (context.data.model !== undefined) {
    const model = String(context.data.model).trim();
    if (!model) throw new BadRequest('model is required');
    context.data.model = model;
  }
  if (context.data.agent_config_id !== undefined) {
    await assertOwnedConfig(context);
  }
  context.data.updated_at = new Date().toISOString();
  return context;
}

/**
 * scopeByUser sets params.knex; @feathersjs/knex _patch re-fetches with id $in but _find
 * ignores params.query when params.knex is set, so the post-patch find returns wrong rows
 * and throws NotFound. Verify ownership, then clear knex (same as user-repos / loops).
 */
async function requireOwnPreset(context) {
  if (context.method !== 'patch' || context.id == null) return context;
  const userId = context.params.user?.id;
  if (!userId) return context;
  const row = await context.app
    .get('db')('agent_model_presets')
    .where({ id: context.id, user_id: userId })
    .first();
  if (!row) throw new NotFound('Preset not found');
  delete context.params.knex;
  return context;
}

async function beforeRemove(context) {
  const row = await context.service.get(context.id, { user: context.params.user });
  if (!row) throw new NotFound('Preset not found');
  if (String(row.user_id) !== String(context.params.user?.id)) {
    throw new Forbidden('Not allowed to delete this preset');
  }
  return context;
}

const PATCH_FIELDS = ['description', 'agent_config_id', 'model', 'model_params'];

export function registerAgentModelPresetsService(app, path = 'agent-model-presets') {
  const options = {
    Model: app.get('db'),
    name: 'agent_model_presets',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new AgentModelPresetsService(options), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeByUser],
      create: [beforeCreate, assertOwnedConfig, normalizeModelParams],
      patch: [requireOwnPreset, only(PATCH_FIELDS), beforePatch, normalizeModelParams],
      remove: [beforeRemove],
    },
    after: {
      find: [attachAgentSdkToResult],
      get: [attachAgentSdkToResult],
      create: [attachAgentSdkToResult],
      patch: [attachAgentSdkToResult],
    },
  });
}
