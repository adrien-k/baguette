import { BadRequest } from 'feathers/errors';
import { getGithubAppConfig } from '../../lib/instance-settings.js';
import { requireAdmin, requireUser } from './hooks.js';

async function publicInstanceSettingsShape(db) {
  const config = await getGithubAppConfig(db);
  return {
    configured: config.configured,
    slug: config.slug,
    app_id: config.app_id,
    client_id: config.client_id,
  };
}

class InstanceSettingsService {
  constructor(options) {
    this.options = options;
  }

  get db() {
    return this.options.Model;
  }

  async get(_id, _params) {
    return publicInstanceSettingsShape(this.db);
  }

  async find(_params) {
    return publicInstanceSettingsShape(this.db);
  }

  async create(_data, _params) {
    throw new BadRequest('GitHub App credentials are configured via the manifest flow');
  }

  async patch(_id, _data, _params) {
    throw new BadRequest('GitHub App credentials are configured via the manifest flow');
  }

  async remove(_id, _params) {
    throw new BadRequest('GitHub App credentials are configured via the manifest flow');
  }
}

const instanceSettingsHooks = {
  before: {
    all: [requireUser],
    create: [requireAdmin],
    patch: [requireAdmin],
    remove: [requireAdmin],
  },
};

export function registerInstanceSettingsService(app, path = 'instance-settings') {
  app.use(path, new InstanceSettingsService({ Model: app.get('db') }), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
  });
  app.service(path).hooks(instanceSettingsHooks);
}
