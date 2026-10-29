import { NotFound } from 'feathers/errors';
import { requireUser } from './hooks.js';
import { getActiveAgents } from '../system-information.js';
import {
  fetchUsageAgentConfigs,
  fetchUsageBreakdown,
  fetchUsageUsers,
  parseUsageFilters,
} from '../../lib/usage-queries.js';

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

  async usageUsers(data = {}, params = {}) {
    const db = this.app.get('db');
    const { days, search } = parseUsageFilters(data, params.query);
    return fetchUsageUsers(db, { days, search });
  }
}

export function registerUsageService(app, path = 'usage') {
  app.use(path, new UsageService(), {
    methods: ['breakdown', 'agentConfigs', 'activeAgents', 'usageUsers'],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser],
    },
  });
}
