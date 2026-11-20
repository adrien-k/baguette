import { NotFound } from 'feathers/errors';
import { requireUser } from './hooks.js';
import { listSdkPlugins } from '../../agent-sdks/registry.js';
import { getCachedSubscriptionLimits } from '../../lib/subscription-limits.js';
import { getActiveAgents } from '../system-information.js';
import {
  fetchUsageAgentConfigs,
  fetchUsageBreakdown,
  fetchUsageModels,
  fetchUsageUsers,
  parseUsageFilters,
} from '../../lib/usage-queries.js';

/** The requested config when it belongs to this SDK, else the user's first config for it. */
async function resolveConfigForSdk(db, userId, sdk, requestedId) {
  const query = db('agent_configs').where({ user_id: userId, sdk });
  if (requestedId != null) {
    const match = await query.clone().where({ id: requestedId }).first('id', 'label');
    if (match) return match;
  }
  return (await query.orderBy('id').first('id', 'label')) ?? null;
}

class UsageService {
  setup(app) {
    this.app = app;
  }

  /** Required for Feathers HTTP service registration (custom methods only). */
  async get() {
    throw new NotFound();
  }

  async breakdown(data = {}, params = {}) {
    const db = this.app.get('db');
    const filters = parseUsageFilters(data, params.query);
    return fetchUsageBreakdown(db, filters);
  }

  async agentConfigs(data = {}, params = {}) {
    const db = this.app.get('db');
    const { days, userId } = parseUsageFilters(data, params.query);
    return fetchUsageAgentConfigs(db, { days, userId });
  }

  async activeAgents(data = {}, params = {}) {
    const { userId } = parseUsageFilters(data, params.query);
    return getActiveAgents(userId, this.app.get('db'));
  }

  /**
   * Plan limits (Claude session/weekly/spend, Cursor included usage) for the signed-in user,
   * one entry per SDK plugin that can report them (only `agent_sdk` when given). Cached
   * ~55s (the card polls every 60s); `refresh: true` forces a fetch ("Refresh"). `agent_config_id` picks the
   * credentials for that config's SDK; other SDKs use the user's first config.
   */
  async subscriptionLimits(data = {}, params = {}) {
    const userId = params.user.id;
    const db = this.app.get('db');
    const refresh = data.refresh === true || params.query?.refresh === 'true';
    const requestedConfigId = data.agent_config_id ?? null;
    const plugins = listSdkPlugins().filter(
      (p) =>
        typeof p.fetchSubscriptionLimits === 'function' &&
        (data.agent_sdk == null || p.key === data.agent_sdk)
    );

    const providers = await Promise.all(
      plugins.map(async (plugin) => {
        const config = await resolveConfigForSdk(db, userId, plugin.key, requestedConfigId);
        const agentConfigId = config?.id ?? null;
        const result = await getCachedSubscriptionLimits(
          `${userId}:${plugin.key}:${agentConfigId ?? ''}`,
          () => plugin.fetchSubscriptionLimits({ app: this.app, userId, agentConfigId }),
          { refresh }
        );
        // The agent config's name is the account name; email/plan come from the provider.
        const account = { ...result.account, name: config?.label ?? null };
        return { sdk: plugin.key, label: plugin.label, ...result, account };
      })
    );
    return { providers };
  }

  async usageUsers(data = {}, params = {}) {
    const db = this.app.get('db');
    const { days, search } = parseUsageFilters(data, params.query);
    return fetchUsageUsers(db, { days, search });
  }

  async usageModels(data = {}, params = {}) {
    const db = this.app.get('db');
    const { days, search, userId } = parseUsageFilters(data, params.query);
    return fetchUsageModels(db, { days, search, userId });
  }
}

export function registerUsageService(app, path = 'usage') {
  app.use(path, new UsageService(), {
    methods: [
      'breakdown',
      'subscriptionLimits',
      'agentConfigs',
      'activeAgents',
      'usageUsers',
      'usageModels',
    ],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser],
    },
  });
}
