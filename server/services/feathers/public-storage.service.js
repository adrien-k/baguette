import { BadRequest } from 'feathers/errors';
import { randomUUID } from 'crypto';
import { encrypt } from '../../lib/encrypt.js';
import {
  getPublicStorageConfig,
  invalidatePublicStorageCache,
  publicStorageSettingsShape,
} from '../../lib/public-storage-config.js';
import {
  uploadPublicObject,
  deletePublicObject,
  isPublicStorageConfigured,
} from '../../lib/public-object-storage.js';
import { requireAdmin, requireUser } from './hooks.js';
import { groomSessionImages } from './session-images.service.js';

const PUBLIC_STORAGE_COLUMNS = {
  endpoint_url: 'public_storage_endpoint_url',
  bucket: 'public_storage_bucket',
  region: 'public_storage_region',
  access_key_id: 'public_storage_access_key_id',
  public_base_url: 'public_storage_public_base_url',
};

function normalizeOptionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

class PublicStorageService {
  constructor(options) {
    this.options = options;
  }

  setup(app) {
    this.app = app;
  }

  get db() {
    return this.options.Model;
  }

  async get(_id, _params) {
    return publicStorageSettingsShape(this.db);
  }

  async find(_params) {
    return publicStorageSettingsShape(this.db);
  }

  async patch(_id, data, _params) {
    const updates = { updated_at: new Date().toISOString() };
    for (const [apiField, dbCol] of Object.entries(PUBLIC_STORAGE_COLUMNS)) {
      if (data[apiField] !== undefined) {
        updates[dbCol] = normalizeOptionalText(data[apiField]);
      }
    }
    if (data.secret_access_key !== undefined) {
      const secret =
        typeof data.secret_access_key === 'string' ? data.secret_access_key.trim() : '';
      updates.public_storage_secret_access_key_encrypted = secret ? encrypt(secret) : null;
    }
    if (Object.keys(updates).length > 1) {
      await this.db('instance_settings').where({ id: 1 }).update(updates);
      invalidatePublicStorageCache();
    }
    return publicStorageSettingsShape(this.db);
  }

  async remove(_id, _params) {
    await this.db('instance_settings').where({ id: 1 }).update({
      public_storage_endpoint_url: null,
      public_storage_bucket: null,
      public_storage_region: null,
      public_storage_access_key_id: null,
      public_storage_secret_access_key_encrypted: null,
      public_storage_public_base_url: null,
      updated_at: new Date().toISOString(),
    });
    invalidatePublicStorageCache();
    return publicStorageSettingsShape(this.db);
  }

  async test(_data, _params) {
    const config = await getPublicStorageConfig(this.db);
    if (!isPublicStorageConfigured(config)) {
      throw new BadRequest('Public object storage is not fully configured');
    }
    const key = `baguette/_health/${randomUUID()}.txt`;
    try {
      await uploadPublicObject({
        config,
        key,
        body: Buffer.from('ok'),
        mediaType: 'text/plain',
      });
      await deletePublicObject({ config, key });
    } catch (err) {
      throw new BadRequest(err?.message ?? String(err));
    }
    return { ok: true };
  }

  async groom(data, _params) {
    const sessionId = data?.session_id != null ? Number(data.session_id) : null;
    const deleted = await groomSessionImages(this.app, sessionId);
    return { deleted };
  }
}

function pickPublicStoragePatchFields(context) {
  const allowed = [
    'endpoint_url',
    'bucket',
    'region',
    'access_key_id',
    'public_base_url',
    'secret_access_key',
  ];
  const data = {};
  for (const key of allowed) {
    if (context.data[key] !== undefined) data[key] = context.data[key];
  }
  context.data = data;
  return context;
}

const publicStorageHooks = {
  before: {
    all: [requireUser],
    patch: [requireAdmin, pickPublicStoragePatchFields],
    remove: [requireAdmin],
    test: [requireAdmin],
    groom: [requireAdmin],
  },
};

export function registerPublicStorageService(app, path = 'admin/public-storage') {
  app.use(path, new PublicStorageService({ Model: app.get('db') }), {
    methods: ['find', 'get', 'patch', 'remove', 'test', 'groom'],
  });
  app.service(path).hooks(publicStorageHooks);
}
