import { KnexService } from '@feathersjs/knex';
import { BadRequest } from 'feathers/errors';
import { requireUser, scopeBySessionUser, only } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { assertTodoStatus } from '../session-todos.js';
import { nextSessionItemRef } from '../session-item-ref.js';

async function resolveTodoPlanId(db, sessionId, planId) {
  if (planId == null || planId === '') return null;
  const id = Number(planId);
  if (!Number.isInteger(id) || id < 1) {
    throw new BadRequest('Invalid plan_id');
  }
  const plan = await db('session_plans').where({ id, session_id: sessionId }).first();
  if (!plan) throw new BadRequest('plan_id not found in session');
  return id;
}

class SessionTodosService extends KnexService {
  async create(data, params) {
    const title = data.title != null ? String(data.title).trim() : '';
    if (!title) throw new BadRequest('title is required');
    const content = data.content != null ? String(data.content).trim() : '';
    if (!content) throw new BadRequest('content is required');
    if (data.status) {
      try {
        assertTodoStatus(data.status);
      } catch (err) {
        throw new BadRequest(err.message);
      }
    }
    const ref = await nextSessionItemRef(this.options.Model, 'session_todos', data.session_id);
    const planId = await resolveTodoPlanId(this.options.Model, data.session_id, data.plan_id);
    return super.create(
      {
        session_id: data.session_id,
        ref,
        title,
        content,
        status: data.status ?? 'pending',
        sort_order: data.sort_order ?? 0,
        plan_id: planId,
      },
      params
    );
  }

  async patch(id, data, params) {
    try {
      if (data.status) assertTodoStatus(data.status);
    } catch (err) {
      throw new BadRequest(err.message);
    }
    const patch = { ...data, updated_at: new Date().toISOString() };
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) throw new BadRequest('title is required');
      patch.title = title;
    }
    if (patch.content !== undefined) {
      const content = String(patch.content).trim();
      if (!content) throw new BadRequest('content is required');
      patch.content = content;
    }
    if (patch.plan_id !== undefined) {
      const existing = await this.get(id, params);
      patch.plan_id = await resolveTodoPlanId(
        this.options.Model,
        existing.session_id,
        patch.plan_id
      );
    }
    return super.patch(id, patch, params);
  }
}

export function registerSessionTodosService(app, path = 'session-todos') {
  const options = {
    Model: app.get('db'),
    name: 'session_todos',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new SessionTodosService(options), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeBySessionUser],
      patch: [only(['title', 'content', 'status', 'sort_order', 'plan_id'])],
    },
  });
}
