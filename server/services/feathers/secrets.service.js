import { KnexService } from '@feathersjs/knex';
import { Forbidden, NotFound } from 'feathers/errors';
import { requireUser, maskValue } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';

/**
 * Secrets: global (user_id null) and personal (user_id set).
 * Personal values override global keys when resolving session env.
 */
class SecretsService extends KnexService {
  async find(params) {
    const userId = params.user?.id;
    const isAdmin = !!params.user?.admin;
    const query = this.options.Model('secrets').orderBy('key');
    if (isAdmin) {
      query.where((qb) => {
        qb.whereNull('user_id');
        if (userId) qb.orWhere({ user_id: userId });
      });
    } else if (userId) {
      query.where({ user_id: userId });
    } else {
      return { data: [], total: 0, limit: 0, skip: 0 };
    }
    const rows = await query;
    return { data: rows, total: rows.length, limit: rows.length, skip: 0 };
  }

  async get(id, params) {
    const row = await this.options.Model('secrets').where({ id }).first();
    if (!row) throw new NotFound('Secret not found');
    if (row.user_id == null && params.provider && !params.user?.admin) {
      throw new Forbidden('Admin required');
    }
    if (row.user_id != null && String(row.user_id) !== String(params.user?.id)) {
      throw new Forbidden('Not allowed to access this secret');
    }
    return row;
  }

  async create(data, params) {
    const userId = params.user?.id;
    if (!userId) throw new Forbidden('Not authenticated');

    const key = String(data.key || '').trim();
    if (!key) throw new Error('key is required');

    const user_id = data.scope === 'global' ? null : userId;
    const db = this.options.Model;
    const existingQuery = db('secrets').where({ key });
    const existing =
      user_id == null
        ? await existingQuery.whereNull('user_id').first()
        : await existingQuery.where({ user_id }).first();

    const value = data.value ?? '';
    if (existing) {
      await db('secrets').where({ id: existing.id }).update({ value });
      return db('secrets').where({ id: existing.id }).first();
    }

    const [id] = await db('secrets').insert({ key, value, user_id });
    return db('secrets').where({ id }).first();
  }

  async patch(id, data, params) {
    const row = await this.get(id, params);
    if (data.value === undefined) return row;
    await this.options.Model('secrets').where({ id }).update({ value: data.value });
    return this.options.Model('secrets').where({ id }).first();
  }

  async remove(id, params) {
    const row = await this.get(id, params);
    await this.options.Model('secrets').where({ id }).delete();
    return row;
  }
}

function maskSecretValues(context) {
  const mask = ({ value, ...row }) => ({ ...row, safeValue: maskValue(value) });
  if (context.result?.data) {
    context.result.data = context.result.data.map(mask);
  } else if (Array.isArray(context.result)) {
    context.result = context.result.map(mask);
  } else if (context.result?.value !== undefined) {
    context.result = mask(context.result);
  }
  return context;
}

function requireAdminForGlobalSecretCreate(context) {
  if (!context.params.provider) return context;
  if (context.data?.scope === 'global' && !context.params.user?.admin) {
    throw new Forbidden('Admin required');
  }
  return context;
}

async function requireAdminForGlobalSecretMutate(context) {
  if (!context.params.provider) return context;
  if (context.method === 'create') return context;
  const row = await context.app.get('db')('secrets').where({ id: context.id }).first();
  if (row?.user_id == null && !context.params.user?.admin) {
    throw new Forbidden('Admin required');
  }
  return context;
}

const secretsHooks = {
  before: {
    all: [requireUser],
    create: [requireAdminForGlobalSecretCreate],
    patch: [requireAdminForGlobalSecretMutate],
    remove: [requireAdminForGlobalSecretMutate],
  },
  after: {
    find: [maskSecretValues],
    get: [maskSecretValues],
    create: [maskSecretValues],
    patch: [maskSecretValues],
  },
};

export function registerSecretsService(app, path = 'secrets') {
  const options = {
    Model: app.get('db'),
    name: 'secrets',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new SecretsService(options));
  app.service(path).hooks(secretsHooks);
}
