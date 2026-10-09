import { KnexService } from '@feathersjs/knex';
import { BadRequest } from '@feathersjs/errors';
import { requireUser, scopeBySessionUser, only } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';

class SessionPlansService extends KnexService {
  async create(data, params) {
    const markdown = data.markdown != null ? String(data.markdown).trim() : '';
    if (!markdown) throw new BadRequest('markdown is required');
    if (!data.session_id) throw new BadRequest('session_id is required');
    return super.create(
      {
        session_id: data.session_id,
        markdown,
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
    return super.patch(id, patch, params);
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
      patch: [only(['markdown'])],
    },
  });
}
