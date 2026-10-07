import { BadRequest, NotFound } from '@feathersjs/errors';
import {
  loadUserForAgentSdk,
  requireRepoAccessForUser,
  assertRepoContext,
} from '../agent-sdk/agent-context.js';
import { requireUser } from './hooks.js';

/** @typedef {{ key: string, label: string, servicePath: string }} AgentSdkMeta */

class AgentSdksService {
  constructor() {
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
  register(data = {}) {
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

  getMetas() {
    return [...this._sdks.values()].map((m) => ({ ...m }));
  }

  getMeta(key) {
    const meta = this._sdks.get(key);
    return meta ? { ...meta } : null;
  }

  /** Feathers path for a registered `agent_sdk` key (unknown keys use the first registered SDK). */
  servicePathFor(sdkKey) {
    const meta = sdkKey ? this._sdks.get(sdkKey) : null;
    if (meta) return meta.servicePath;
    const first = this._sdks.values().next().value;
    return first?.servicePath ?? 'claude-agent';
  }

  /**
   * @param {AgentSdkMeta} meta
   */
  _sdkService(meta) {
    try {
      const svc = this.app.service(meta.servicePath);
      if (!svc || typeof svc.isEnabled !== 'function' || typeof svc.listModels !== 'function') {
        return null;
      }
      return svc;
    } catch {
      return null;
    }
  }

  /**
   * Whether a registered SDK is enabled for this user/repo.
   * @param {string} sdkKey
   * @param {{ user: object, repo?: object | null }} ctx
   * @returns {Promise<boolean>}
   */
  async isEnabled(sdkKey, ctx) {
    const meta = this._sdks.get(sdkKey);
    if (!meta) {
      throw new NotFound(`Unknown agent SDK "${sdkKey}"`);
    }
    const svc = this._sdkService(meta);
    if (!svc) return false;
    return Boolean(await svc.isEnabled(ctx));
  }

  /**
   * Registered SDKs whose Feathers service reports `isEnabled` for this user/repo.
   * @param {{ user: object, repo?: object | null }} ctx
   * @returns {Promise<Array<{ key: string, label: string }>>}
   */
  async listEnabled(ctx) {
    const sdks = [];
    for (const meta of this._sdks.values()) {
      if (await this.isEnabled(meta.key, ctx)) {
        sdks.push({ key: meta.key, label: meta.label });
      }
    }
    return sdks;
  }

  /**
   * @param {string} sdkKey
   * @param {{ user: object, repo?: object | null }} ctx
   * @param {{ refresh?: boolean }} [opts]
   */
  async listModelsForSdk(sdkKey, ctx, { refresh = false } = {}) {
    assertRepoContext(ctx);
    if (!(await this.isEnabled(sdkKey, ctx))) return null;
    const meta = this._sdks.get(sdkKey);
    const svc = this._sdkService(meta);
    if (!svc) return null;
    return svc.listModels(ctx, { refresh });
  }

  async _context(params, { requireRepo = true } = {}) {
    const userId = params.user?.id;
    if (!userId) throw new BadRequest('Authentication required');
    const knex = this.app.get('db');
    const user = await loadUserForAgentSdk(userId, knex);
    if (!user) throw new NotFound('User not found');

    const repoIdRaw = params.query?.repo_id ?? params.query?.repoId;
    if (repoIdRaw == null || repoIdRaw === '') {
      if (requireRepo) throw new BadRequest('repo_id is required');
      return { user, repo: null };
    }
    const repoId = Number(repoIdRaw);
    if (!Number.isFinite(repoId)) throw new BadRequest('repo_id must be a number');
    const repo = await requireRepoAccessForUser(repoId, userId, knex);
    if (!repo) throw new NotFound('Repository not found or not linked to your account');

    return { user, repo };
  }

  /** List registered SDKs that are enabled (account keys; repo keys when `repo_id` is set). */
  async find(params) {
    const ctx = await this._context(params, { requireRepo: false });
    return { sdks: await this.listEnabled(ctx) };
  }

  /** List models for one SDK (`query.sdk`, `query.repo_id`). */
  async models(_data, params) {
    const sdk = params.query?.sdk;
    if (!sdk || typeof sdk !== 'string') {
      throw new BadRequest('query.sdk is required');
    }
    if (!this._sdks.has(sdk)) {
      throw new NotFound(`Unknown agent SDK "${sdk}"`);
    }
    const ctx = await this._context(params);
    const refresh = params.query?.refresh === 'true' || params.query?.refresh === '1';
    const models = await this.listModelsForSdk(sdk, ctx, { refresh });
    if (models == null) {
      throw new NotFound(`Agent SDK "${sdk}" is not available`);
    }
    return { models };
  }

  /**
   * Connectivity test for agent credentials. Body: { sdk, repo_id?, ...field overrides }.
   */
  async test(data, params) {
    const sdk = data?.sdk ?? data?.agent_sdk;
    if (!sdk || typeof sdk !== 'string') {
      throw new BadRequest('sdk is required');
    }
    if (!this._sdks.has(sdk)) {
      throw new NotFound(`Unknown agent SDK "${sdk}"`);
    }
    const userId = params.user?.id;
    if (!userId) throw new BadRequest('Authentication required');
    const knex = this.app.get('db');
    const user = await loadUserForAgentSdk(userId, knex);
    if (!user) throw new NotFound('User not found');

    let repo = null;
    const repoIdRaw = data?.repo_id;
    if (repoIdRaw != null && repoIdRaw !== '') {
      const repoId = Number(repoIdRaw);
      if (!Number.isFinite(repoId)) throw new BadRequest('repo_id must be a number');
      repo = await requireRepoAccessForUser(repoId, userId, knex);
      if (!repo) throw new NotFound('Repository not found or not linked to your account');
    }

    const meta = this._sdks.get(sdk);
    const svc = this._sdkService(meta);
    if (!svc || typeof svc.testCredentials !== 'function') {
      throw new BadRequest(`Agent SDK "${sdk}" does not support credential tests`);
    }

    const payload = { ...data };
    delete payload.sdk;
    delete payload.agent_sdk;
    delete payload.repo_id;

    return svc.testCredentials({ user, repo, payload });
  }

  async get() {
    return null;
  }
}

/**
 * Record an SDK on the agent-sdks service. No-op when that service is not mounted
 * (unit tests that register a single agent service in isolation).
 * @param {import('@feathersjs/feathers').Application} app
 * @param {{ key: string, label: string, servicePath: string }} meta
 */
export function registerAgentSdk(app, { key, label, servicePath }) {
  if (!app.services?.['agent-sdks']) return;
  return app.service('agent-sdks').register({
    key,
    label,
    service_path: servicePath,
  });
}

export function registerAgentSdksService(app, path = 'agent-sdks') {
  const service = new AgentSdksService();
  service.setup(app);
  app.use(path, service, {
    methods: ['find', 'get', 'models', 'test'],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser],
      find: [],
      get: [],
      models: [],
      test: [],
    },
  });
}
