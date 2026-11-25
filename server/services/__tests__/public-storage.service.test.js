/**
 * Integration tests for admin/public-storage Feathers service.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerPublicStorageService } from '../feathers/public-storage.service.js';
import { encrypt } from '../../lib/encrypt.js';
import { invalidatePublicStorageCache } from '../../lib/public-storage-config.js';

const s3Mocks = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({}),
  clientConfigs: [],
}));

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    constructor(config) {
      s3Mocks.clientConfigs.push(config ?? {});
      this.send = s3Mocks.send;
    }
  }
  class PutObjectCommand {
    constructor(input) {
      Object.assign(this, input);
    }
  }
  class DeleteObjectCommand {
    constructor(input) {
      Object.assign(this, input);
    }
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand };
});

const db = createTestDb();

const adminParams = { provider: 'rest', user: { id: 1, admin: 1 } };
const userParams = { provider: 'rest', user: { id: 2, admin: 0 } };

let app;

beforeEach(async () => {
  invalidatePublicStorageCache();
  s3Mocks.send.mockReset();
  s3Mocks.clientConfigs.length = 0;
  s3Mocks.send.mockResolvedValue({});
  app = feathers();
  app.set('db', db);
  await db('users').del();
  await db('users').insert([
    { id: 1, github_id: 1, username: 'admin', status: 'approved', admin: 1 },
    { id: 2, github_id: 2, username: 'member', status: 'approved', admin: 0 },
  ]);
  await db('instance_settings').where({ id: 1 }).update({
    public_storage_endpoint_url: null,
    public_storage_bucket: null,
    public_storage_region: null,
    public_storage_access_key_id: null,
    public_storage_secret_access_key_encrypted: null,
    public_storage_public_base_url: null,
  });
  registerPublicStorageService(app);
  await app.setup();
});

const service = () => app.service('admin/public-storage');

describe('get / find', () => {
  it('returns unconfigured shape without secrets', async () => {
    const result = await service().get(1, userParams);
    expect(result).toEqual({
      configured: false,
      endpoint_url: null,
      bucket: null,
      region: null,
      access_key_id: null,
      public_base_url: null,
      secret_configured: false,
    });
    expect(result.secret_access_key).toBeUndefined();
    expect(await service().find(userParams)).toEqual(result);
  });
});

describe('patch', () => {
  it('round-trips settings without returning the secret', async () => {
    const patched = await service().patch(
      1,
      {
        endpoint_url: 'https://s3.example.com',
        bucket: 'pub',
        region: 'us-west-2',
        access_key_id: 'AKIA',
        public_base_url: 'https://cdn.example.com/',
        secret_access_key: 'shhh',
      },
      adminParams
    );
    expect(patched).toEqual({
      configured: true,
      endpoint_url: 'https://s3.example.com',
      bucket: 'pub',
      region: 'us-west-2',
      access_key_id: 'AKIA',
      public_base_url: 'https://cdn.example.com/',
      secret_configured: true,
    });
    expect(patched.secret_access_key).toBeUndefined();

    const row = await db('instance_settings').where({ id: 1 }).first();
    expect(row.public_storage_secret_access_key_encrypted).toBeTruthy();
    expect(row.public_storage_secret_access_key_encrypted).not.toBe('shhh');
  });

  it('rejects non-admin patch', async () => {
    await expect(service().patch(1, { bucket: 'x' }, userParams)).rejects.toThrow(
      /Admin required|Forbidden/
    );
  });

  it('marks configured when credentials are omitted (IAM role)', async () => {
    const patched = await service().patch(
      1,
      {
        endpoint_url: 'https://s3.amazonaws.com',
        bucket: 'pub',
        region: 'us-east-1',
        access_key_id: '',
        public_base_url: 'https://cdn.example.com/',
        secret_access_key: '',
      },
      adminParams
    );
    expect(patched).toEqual({
      configured: true,
      endpoint_url: 'https://s3.amazonaws.com',
      bucket: 'pub',
      region: 'us-east-1',
      access_key_id: null,
      public_base_url: 'https://cdn.example.com/',
      secret_configured: false,
    });
  });
});

describe('remove', () => {
  it('clears all public storage columns', async () => {
    await db('instance_settings')
      .where({ id: 1 })
      .update({
        public_storage_endpoint_url: 'https://s3.example.com',
        public_storage_bucket: 'pub',
        public_storage_access_key_id: 'AKIA',
        public_storage_secret_access_key_encrypted: encrypt('secret'),
        public_storage_public_base_url: 'https://cdn.example.com',
      });
    invalidatePublicStorageCache();

    const result = await service().remove(1, adminParams);
    expect(result.configured).toBe(false);
    expect(result.secret_configured).toBe(false);

    const row = await db('instance_settings').where({ id: 1 }).first();
    expect(row.public_storage_endpoint_url).toBeNull();
    expect(row.public_storage_bucket).toBeNull();
    expect(row.public_storage_access_key_id).toBeNull();
    expect(row.public_storage_secret_access_key_encrypted).toBeNull();
    expect(row.public_storage_public_base_url).toBeNull();
  });
});

describe('test', () => {
  it('uploads and deletes a health object', async () => {
    await service().patch(
      1,
      {
        endpoint_url: 'https://s3.example.com',
        bucket: 'pub',
        access_key_id: 'AKIA',
        public_base_url: 'https://cdn.example.com',
        secret_access_key: 'secret',
      },
      adminParams
    );
    const result = await service().test({}, adminParams);
    expect(result).toEqual({ ok: true });
    expect(s3Mocks.send).toHaveBeenCalledTimes(2);
  });

  it('uses the default credential chain when keys are omitted', async () => {
    await service().patch(
      1,
      {
        endpoint_url: 'https://s3.amazonaws.com',
        bucket: 'pub',
        region: 'us-east-1',
        access_key_id: '',
        public_base_url: 'https://cdn.example.com',
        secret_access_key: '',
      },
      adminParams
    );
    const result = await service().test({}, adminParams);
    expect(result).toEqual({ ok: true });
    expect(s3Mocks.clientConfigs[0]?.credentials).toBeUndefined();
  });
});
