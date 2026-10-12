import { KnexService } from '@feathersjs/knex';
import { BadRequest, Forbidden, NotFound } from '@feathersjs/errors';
import { requireUser, encryptFields, decryptFields, maskValue } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { normalizeAnthropicBaseUrl } from '../session-env.js';
import { decryptAgentConfigRow } from '../agent-config-env.js';
import { testFromAgentConfig } from '../agent-sdk-credential-test.js';
import { truncateLabel } from '../../../shared/agent-config-labels.js';
import { resolveSessionFormDefaults } from '../agent-config-resolver.js';
import {
  defaultAgentConfigApiKeyEnvVar,
  normalizeAgentConfigApiKeyEnvVar,
} from '../../../shared/agent-config-api-key-env.js';
import { dispatchCreatedMessageToAgents } from '../agent-message-dispatch.js';
import {
  parseAgentDefaultModelJson,
  stringifyAgentDefaultModel,
} from '../../../shared/agent-default-model.js';
import { listModelsForAgentConfig } from '../agent-models-for-sdk.js';
import {
  applyCredentialOverridesToConfig,
  credentialOverridesFromQuery,
  draftAgentConfigForConnectivityTest,
  resolveListModelsRequest,
} from '../agent-config-credential-overrides.js';
import { normalizeAgentConfigLogo } from '../../../shared/agent-config-logo.js';
import { throwIfAgentConfigDeleted } from '../agent-config-deleted.js';

const VALID_SDKS = new Set(['claude', 'cursor', 'pi', 'mock']);

/** @typedef {{ key: string, label: string, servicePath: string }} AgentSdkMeta */

/**
 * List models for an owned agent configuration using that config's SDK service.
 * @param {import('@feathersjs/feathers').Application} app
 * @param {{ configId: number, userId: number, refresh?: boolean, credentialOverrides?: Record<string, string> }} opts
 */
export async function listModelsForOwnedConfig(
  app,
  { configId, userId, refresh = false, credentialOverrides = {} }
) {
  const knex = app.get('db');
  const row = await knex('agent_configs').where({ id: configId, user_id: userId }).first();
  if (!row) throw new NotFound('Agent configuration not found');
  throwIfAgentConfigDeleted(row);
  const config = applyCredentialOverridesToConfig(decryptAgentConfigRow(row), credentialOverrides);
  let user = null;
  try {
    user = await app.service('users').get(userId, { provider: undefined });
  } catch {
    user = null;
  }
  return listModelsForAgentConfigShape(app, { config, refresh, user });
}

/**
 * List models for an unsaved agent configuration (form credentials).
 * @param {import('@feathersjs/feathers').Application} app
 * @param {{ sdk: string, refresh?: boolean, credentialOverrides?: Record<string, string> }} opts
 */
async function listModelsForDraftConfig(app, { sdk, refresh = false, credentialOverrides = {} }) {
  if (!VALID_SDKS.has(sdk)) {
    throw new BadRequest('sdk must be claude, cursor, pi, or mock');
  }
  const config = draftAgentConfigForConnectivityTest(sdk, credentialOverrides);
  return listModelsForAgentConfigShape(app, { config, refresh, user: null });
}

async function listModelsForAgentConfigShape(app, { config, refresh, user = null }) {
  const configs = app.service('agent-configs');
  if (!configs.getSdkMeta(config.sdk)) {
    throw new NotFound(`Agent SDK "${config.sdk}" is not available`);
  }
  const result = await listModelsForAgentConfig(config.sdk, config, { refresh, user });
  return {
    models: result?.models ?? [],
    rejected_models: result?.rejected_models ?? [],
  };
}

class AgentConfigsService extends KnexService {
  constructor(options) {
    super(options);
    /** @type {Map<string, AgentSdkMeta>} */
    this._sdks = new Map();
  }

  setup(app) {
    this.app = app;
  }

  /**
   * Register an agent SDK service. Called by each SDK service at startup.
   * @param {{ key?: string, label?: string, service_path?: string, servicePath?: string }} data
   */
  registerSdk(data = {}) {
    const key = data.key;
    const label = data.label;
    const servicePath = data.service_path ?? data.servicePath;
    if (!key || !label || !servicePath) {
      throw new BadRequest('key, label, and service_path are required');
    }
    if (this._sdks.has(key)) {
      throw new BadRequest(`Duplicate agent SDK key: ${key}`);
    }
    this._sdks.set(key, { key, label, servicePath });
    return { key, label, service_path: servicePath };
  }

  getSdkMetas() {
    return [...this._sdks.values()].map((m) => ({ ...m }));
  }

  getSdkMeta(key) {
    const meta = this._sdks.get(key);
    return meta ? { ...meta } : null;
  }

  /** Feathers path for a registered `agent_sdk` key (unknown keys use the first registered SDK). */
  servicePathForSdk(sdkKey) {
    const meta = sdkKey ? this._sdks.get(sdkKey) : null;
    if (meta) return meta.servicePath;
    const first = this._sdks.values().next().value;
    return first?.servicePath ?? 'claude-agent';
  }

  /**
   * Route a persisted user message to the SDK service for the session's agent config.
   * @param {object} row
   */
  async dispatchCreatedMessage(row) {
    await dispatchCreatedMessageToAgents(this.app, row, 'messages');
  }

  async _ownedRow(id, userId) {
    const row = await this.options.Model('agent_configs').where({ id, user_id: userId }).first();
    if (!row || row.deleted_at) throw new NotFound('Agent configuration not found');
    return row;
  }

  async find(params) {
    const userId = params.user?.id;
    if (!userId) throw new Forbidden('Not authenticated');
    const knex = this.options.Model;
    const { ensureMockAgentConfig } = await import('../mock-agent-config.js');
    await ensureMockAgentConfig(knex, userId);
    const rows = await this.options
      .Model('agent_configs')
      .where({ user_id: userId })
      .whereNull('deleted_at')
      .orderBy('label', 'asc');
    return { data: rows, total: rows.length, limit: rows.length, skip: 0 };
  }

  async get(id, params) {
    return this._ownedRow(id, params.user?.id);
  }

  async create(data, params) {
    const userId = params.user?.id;
    if (!userId) throw new Forbidden('Not authenticated');
    return super.create({ ...data, user_id: userId }, { ...params, provider: undefined });
  }

  async patch(id, data, params) {
    await this._ownedRow(id, params.user?.id);
    return super.patch(id, data, params);
  }

  async remove(id, params) {
    const userId = params.user?.id;
    const row = await this._ownedRow(id, userId);
    const knex = this.app.get('db');
    const configId = Number(id);
    const deletedAt = new Date().toISOString();
    await knex('agent_configs')
      .where({ id: configId, user_id: userId })
      .update({ deleted_at: deletedAt, updated_at: deletedAt });
    return { ...row, deleted_at: deletedAt };
  }

  async listModels(data, params) {
    const userId = params.user?.id;
    if (!userId) throw new Forbidden('Not authenticated');
    const { id, sdk, refresh, credentialOverrides } = resolveListModelsRequest(
      data,
      params.query ?? {}
    );
    let models;
    let rejected_models = [];
    if (id != null) {
      const result = await listModelsForOwnedConfig(this.app, {
        configId: Number(id),
        userId,
        refresh,
        credentialOverrides,
      });
      models = result.models;
      rejected_models = result.rejected_models;
    } else {
      if (!sdk) throw new BadRequest('id or sdk is required');
      const result = await listModelsForDraftConfig(this.app, {
        sdk: String(sdk),
        refresh,
        credentialOverrides,
      });
      models = result.models;
      rejected_models = result.rejected_models;
    }
    return { models, rejected_models };
  }

  async lastUsed(data, params) {
    const userId = params.user?.id;
    if (!userId) throw new Forbidden('Not authenticated');
    const repoIdRaw = data?.repo_id;
    const repoId = repoIdRaw != null && repoIdRaw !== '' ? Number(repoIdRaw) : null;
    if (repoId != null && !Number.isFinite(repoId)) {
      throw new BadRequest('repo_id must be a number');
    }
    return resolveSessionFormDefaults(this.app.get('db'), userId, repoId);
  }

  async testConnectivity(data, params) {
    const payload = { ...(data?.payload ?? data) };
    const id = payload.id ?? payload.agent_config_id;
    const sdk = payload.sdk;
    delete payload.id;
    delete payload.agent_config_id;
    delete payload.payload;
    delete payload.sdk;
    const overrides = credentialOverridesFromQuery(payload);

    let config;
    if (id != null) {
      const row = await this._ownedRow(Number(id), params.user?.id);
      config = applyCredentialOverridesToConfig(decryptAgentConfigRow(row), overrides);
    } else {
      if (!sdk) throw new BadRequest('id or sdk is required');
      if (!VALID_SDKS.has(sdk)) {
        throw new BadRequest('sdk must be claude, cursor, pi, or mock');
      }
      config = draftAgentConfigForConnectivityTest(sdk, overrides);
    }

    return testFromAgentConfig(config);
  }
}

async function validateAgentConfigWrite(context) {
  const data = context.data;
  if (data.label !== undefined) {
    const label = truncateLabel(String(data.label).trim());
    if (!label) throw new BadRequest('label is required');
    data.label = label;
  } else if (context.method === 'create') {
    throw new BadRequest('label is required');
  }
  if (data.sdk !== undefined && !VALID_SDKS.has(data.sdk)) {
    throw new BadRequest('sdk must be claude, cursor, pi, or mock');
  }
  if (data.api_url !== undefined) {
    data.api_url = normalizeAnthropicBaseUrl(data.api_url);
  }
  if (data.extra_env_json !== undefined && data.extra_env_json != null) {
    if (typeof data.extra_env_json === 'object') {
      data.extra_env_json = JSON.stringify(data.extra_env_json);
    }
  }
  if (data.logo !== undefined) {
    if (data.logo == null || data.logo === '') {
      data.logo = null;
    } else {
      try {
        data.logo = normalizeAgentConfigLogo(data.logo);
      } catch (err) {
        throw new BadRequest(err.message);
      }
    }
  }

  if (data.default_model !== undefined) {
    if (data.default_model == null || data.default_model === '') {
      data.default_model = null;
    } else {
      data.default_model = stringifyAgentDefaultModel(
        parseAgentDefaultModelJson(data.default_model)
      );
    }
  }

  let effectiveSdk = data.sdk;
  if (effectiveSdk === undefined && context.method === 'patch' && context.id != null) {
    const row = await context.service._ownedRow(context.id, context.params.user?.id);
    effectiveSdk = row.sdk;
  }

  if (context.method === 'create' && data.sdk) {
    if (data.sdk === 'cursor' || data.sdk === 'mock') {
      data.api_key_env_var = null;
    } else if (data.api_key_env_var == null || data.api_key_env_var === '') {
      data.api_key_env_var = defaultAgentConfigApiKeyEnvVar(data.sdk);
    }
  }

  if (data.api_key_env_var !== undefined || data.sdk !== undefined) {
    if (effectiveSdk === 'cursor' || effectiveSdk === 'mock') {
      data.api_key_env_var = null;
    } else if (data.api_key_env_var !== undefined && effectiveSdk) {
      try {
        data.api_key_env_var = normalizeAgentConfigApiKeyEnvVar(effectiveSdk, data.api_key_env_var);
      } catch (err) {
        throw new BadRequest(err.message);
      }
    }
  }

  return context;
}

async function ensureUniqueLabel(context) {
  if (context.method !== 'create' && context.data.label === undefined) return context;
  const userId = context.params.user?.id;
  const label = context.data.label ?? (context.method === 'create' ? null : undefined);
  if (!label) return context;
  const db = context.service.options.Model;
  let q = db('agent_configs')
    .where({ user_id: userId })
    .whereNull('deleted_at')
    .whereRaw('LOWER(label) = ?', [label.toLowerCase()]);
  if (context.method === 'patch') q = q.whereNot('id', context.id);
  const existing = await q.first();
  if (existing) throw new BadRequest(`Label "${label}" is already in use`);
  return context;
}

function formatExternal(context) {
  if (!context.params.provider) return context;
  const mask = (row) => {
    if (!row) return row;
    const configured = Boolean(row.api_key_encrypted ?? row.api_key);
    const { api_key_encrypted: _enc, ...rest } = row;
    return {
      ...rest,
      api_key_configured: configured,
      api_key: configured ? (row.api_key ?? maskValue('secret')) : null,
      default_model: parseAgentDefaultModelJson(row.default_model),
    };
  };
  const r = context.result;
  if (r?.data) context.result = { ...r, data: r.data.map(mask) };
  else if (Array.isArray(r)) context.result = r.map(mask);
  else if (r) context.result = mask(r);
  return context;
}

const encryptApiKey = encryptFields({ api_key: 'api_key_encrypted' });
const decryptApiKey = decryptFields({ api_key: 'api_key_encrypted' });

const agentConfigsHooks = {
  before: {
    all: [requireUser],
    create: [validateAgentConfigWrite, ensureUniqueLabel, encryptApiKey],
    patch: [validateAgentConfigWrite, ensureUniqueLabel, encryptApiKey],
  },
  after: {
    find: [decryptApiKey, formatExternal],
    get: [decryptApiKey, formatExternal],
    create: [decryptApiKey, formatExternal],
    patch: [decryptApiKey, formatExternal],
  },
};

/**
 * Record an SDK on the agent-configs service. No-op when that service is not mounted
 * (unit tests that register a single agent service in isolation).
 * @param {import('@feathersjs/feathers').Application} app
 * @param {{ key: string, label: string, servicePath: string }} meta
 */
export function registerAgentSdk(app, { key, label, servicePath }) {
  if (!app.services?.['agent-configs']) return;
  return app.service('agent-configs').registerSdk({
    key,
    label,
    service_path: servicePath,
  });
}

export function registerAgentConfigsService(app, path = 'agent-configs') {
  const options = {
    Model: app.get('db'),
    name: 'agent_configs',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  const service = new AgentConfigsService(options);
  service.setup(app);
  app.use(path, service, {
    methods: [
      'find',
      'get',
      'create',
      'patch',
      'remove',
      'listModels',
      'testConnectivity',
      'lastUsed',
    ],
  });
  app.service(path).hooks(agentConfigsHooks);
}
