/**
 * Integration tests for the instance-settings Feathers service (public GitHub App status).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerInstanceSettingsService } from '../feathers/instance-settings.service.js';
import { encrypt } from '../../lib/encrypt.js';

const db = createTestDb();

const adminParams = { provider: 'rest', user: { id: 1, admin: 1 } };
const userParams = { provider: 'rest', user: { id: 2, admin: 0 } };
const unauthParams = { provider: 'rest' };

let app;

beforeEach(async () => {
  app = feathers();
  app.set('db', db);
  await db('users').insert([
    { id: 1, github_id: 1, username: 'admin', approved: true, admin: 1 },
    { id: 2, github_id: 2, username: 'member', approved: true, admin: 0 },
  ]);
  registerInstanceSettingsService(app);
  await app.setup();
});

const service = () => app.service('instance-settings');

describe('get / find', () => {
  it('returns configured false without secrets on an empty row', async () => {
    const result = await service().get(1, userParams);
    expect(result).toEqual({
      configured: false,
      slug: null,
      app_id: null,
      client_id: null,
    });
    expect(result.client_secret).toBeUndefined();
    expect(result).not.toHaveProperty('client_secret');

    expect(await service().find(userParams)).toEqual(result);
  });

  it('reflects configured App metadata without secrets', async () => {
    await db('instance_settings')
      .where({ id: 1 })
      .update({
        github_app_id: 42,
        github_app_slug: 'baguette-test',
        github_app_client_id: 'gh-client',
        github_app_client_secret_encrypted: encrypt('super-secret'),
      });

    const result = await service().get(1, adminParams);
    expect(result).toEqual({
      configured: true,
      slug: 'baguette-test',
      app_id: 42,
      client_id: 'gh-client',
    });
  });

  it('rejects unauthenticated access', async () => {
    await expect(service().get(1, unauthParams)).rejects.toThrow('Not authenticated');
  });
});

describe('patch', () => {
  it('rejects non-admin callers', async () => {
    await expect(service().patch(1, {}, userParams)).rejects.toThrow(/Admin required|Forbidden/);
  });

  it('rejects admin patch (manifest flow owns writes)', async () => {
    await expect(service().patch(1, {}, adminParams)).rejects.toThrow(/manifest flow/);
  });
});
