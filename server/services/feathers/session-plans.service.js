import { KnexService } from '@feathersjs/knex';
import { BadRequest } from 'feathers/errors';
import { requireUser, scopeBySessionUser, only } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { nextSessionItemRef } from '../session-item-ref.js';

const PLAN_STATUSES = ['open', 'completed'];

function assertPlanStatus(status) {
  if (!PLAN_STATUSES.includes(status)) {
    throw new BadRequest(`status must be one of: ${PLAN_STATUSES.join(', ')}`);
  }
}

function agentRows(result) {
  return Array.isArray(result) ? result : (result?.data ?? []);
}

class SessionPlansService extends KnexService {
  setup(app) {
    this.app = app;
  }

  async clearAgentsOnPlan(planId, params) {
    const result = await this.app.service('agents').find({
      query: { current_plan_id: planId, $limit: 500 },
      paginate: false,
      user: params.user,
    });
    const internal = { user: params.user, provider: undefined };
    for (const agent of agentRows(result)) {
      await this.app.service('agents').patch(agent.id, { current_plan_id: null }, internal);
    }
  }

  async create(data, params) {
    const markdown = data.markdown != null ? String(data.markdown).trim() : '';
    if (!markdown) throw new BadRequest('markdown is required');
    if (!data.session_id) throw new BadRequest('session_id is required');
    const status = data.status ?? 'open';
    assertPlanStatus(status);
    const ref = await nextSessionItemRef(this.options.Model, 'session_plans', data.session_id);
    return super.create(
      {
        session_id: data.session_id,
        markdown,
        ref,
        status,
      },
      params
    );
  }

  async patch(id, data, params) {
    const patch = { ...data, updated_at: new Date().toISOString() };
    if (patch.markdown !== undefined) {
      const markdown = String(patch.markdown).trim();
      if (!markdown) throw new BadRequest('markdown is required');
      patch.markdown = markdown;
    }
    if (patch.status !== undefined) {
      assertPlanStatus(patch.status);
    }
    const row = await super.patch(id, patch, params);
    if (patch.status === 'completed' && row && !Array.isArray(row) && row.id != null) {
      await this.clearAgentsOnPlan(row.id, params);
    }
    return row;
  }
}

export function registerSessionPlansService(app, path = 'session-plans') {
  const options = {
    Model: app.get('db'),
    name: 'session_plans',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new SessionPlansService(options), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeBySessionUser],
      patch: [only(['markdown', 'status'])],
    },
  });
}
