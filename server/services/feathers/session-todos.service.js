import { KnexService } from '@feathersjs/knex';
import { BadRequest } from '@feathersjs/errors';
import { requireUser, scopeBySessionUser, only } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { assertTodoStatus } from '../session-todos.js';

class SessionTodosService extends KnexService {
  async create(data, params) {
    const content = data.content != null ? String(data.content).trim() : '';
    if (!content) throw new BadRequest('content is required');
    if (data.status) {
      try {
        assertTodoStatus(data.status);
      } catch (err) {
        throw new BadRequest(err.message);
      }
    }
    return super.create(
      {
        session_id: data.session_id,
        content,
        status: data.status ?? 'pending',
        sort_order: data.sort_order ?? 0,
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
    if (patch.content !== undefined) {
      const content = String(patch.content).trim();
      if (!content) throw new BadRequest('content is required');
      patch.content = content;
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
      patch: [only(['content', 'status', 'sort_order'])],
    },
  });
}
