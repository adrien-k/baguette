/**
 * Integration tests for the secrets Feathers service.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerSecretsService } from '../feathers/secrets.service.js';

const db = createTestDb();

let adminUser;
let regularUser;
const params = (user) => ({ provider: 'rest', user });
const unauthParams = { provider: 'rest' };

function expectForbidden(promise) {
  return expect(promise).rejects.toThrow(/Admin required|Forbidden/);
}

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSecretsService(app);
  return app;
}

let app;

beforeEach(async () => {
  await db('users').insert([
    { github_id: 1, username: 'admin', approved: true, admin: 1 },
    { github_id: 2, username: 'alice', approved: true, admin: 0 },
  ]);
  adminUser = await db('users').where({ username: 'admin' }).first();
  regularUser = await db('users').where({ username: 'alice' }).first();
  app = makeApp(db);
  await app.setup();
});

describe('Secrets service - find', () => {
  it('admin sees global and personal secrets', async () => {
    await db('secrets').insert([
      { key: 'FOO', value: 'bar', user_id: null },
      { key: 'MINE', value: 'p', user_id: adminUser.id },
    ]);

    const result = await app.service('secrets').find(params(adminUser));
    const data = result.data ?? result;
    expect(data).toHaveLength(2);
    expect(data.map((s) => s.key)).toContain('FOO');
  });

  it('non-admin sees personal secrets only', async () => {
    await db('secrets').insert([
      { key: 'FOO', value: 'bar', user_id: null },
      { key: 'MINE', value: 'p', user_id: regularUser.id },
    ]);

    const result = await app.service('secrets').find(params(regularUser));
    const data = result.data ?? result;
    expect(data).toHaveLength(1);
    expect(data[0].key).toBe('MINE');
  });

  it('returns safeValue (masked) instead of the raw value', async () => {
    await db('secrets').insert({ key: 'API_KEY', value: 'supersecretvalue', user_id: null });

    const result = await app.service('secrets').find(params(adminUser));
    const data = result.data ?? result;
    const row = data.find((s) => s.key === 'API_KEY');
    expect(row.value).toBeUndefined();
    expect(row.safeValue).toMatch(/•/);
    expect(row.safeValue).not.toBe('supersecretvalue');
  });

  it('unauthenticated find is rejected', async () => {
    await expect(app.service('secrets').find(unauthParams)).rejects.toThrow('Not authenticated');
  });
});

describe('Secrets service - create', () => {
  it('admin can create a global secret', async () => {
    await app
      .service('secrets')
      .create({ key: 'NEW_KEY', value: 'secret', scope: 'global' }, params(adminUser));

    const row = await db('secrets').where({ key: 'NEW_KEY' }).first();
    expect(row).toBeTruthy();
    expect(row.value).toBe('secret');
    expect(row.user_id).toBeNull();
  });

  it('non-admin cannot create a global secret', async () => {
    await expectForbidden(
      app
        .service('secrets')
        .create({ key: 'NEW_KEY', value: 'secret', scope: 'global' }, params(regularUser))
    );
  });

  it('admin upserts when key already exists — updates value', async () => {
    await db('secrets').insert({ key: 'EXISTING', value: 'old', user_id: null });

    const result = await app
      .service('secrets')
      .create({ key: 'EXISTING', value: 'new', scope: 'global' }, params(adminUser));

    const rows = await db('secrets').where({ key: 'EXISTING' });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('new');
    expect(result.value).toBeUndefined();
    expect(result.safeValue).toMatch(/•/);
  });

  it('any authenticated user can create a personal secret', async () => {
    await app
      .service('secrets')
      .create({ key: 'K', value: 'v', scope: 'personal' }, params(regularUser));
    const row = await db('secrets').where({ key: 'K', user_id: regularUser.id }).first();
    expect(row).toBeTruthy();
  });

  it('defaults create without scope to a personal secret', async () => {
    await app.service('secrets').create({ key: 'K', value: 'v' }, params(regularUser));
    const row = await db('secrets').where({ key: 'K' }).first();
    expect(row.user_id).toBe(regularUser.id);
  });

  it('does not list another user personal secrets', async () => {
    await db('secrets').insert([
      { key: 'SHARED', value: 'g', user_id: null },
      { key: 'MINE', value: 'p', user_id: regularUser.id },
      { key: 'THEIRS', value: 'x', user_id: adminUser.id },
    ]);
    const result = await app.service('secrets').find(params(regularUser));
    const keys = result.data.map((s) => s.key);
    expect(keys).toContain('MINE');
    expect(keys).not.toContain('THEIRS');
    expect(keys).not.toContain('SHARED');
  });

  it('cannot get another user personal secret', async () => {
    const [id] = await db('secrets').insert({ key: 'THEIRS', value: 'x', user_id: adminUser.id });
    await expect(app.service('secrets').get(id, params(regularUser))).rejects.toThrow(
      'Not allowed to access this secret'
    );
  });

  it('unauthenticated create is rejected', async () => {
    await expect(
      app.service('secrets').create({ key: 'K', value: 'v' }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });
});

describe('Secrets service - get', () => {
  it('admin can get a global secret by id', async () => {
    const [id] = await db('secrets').insert({ key: 'MY_KEY', value: 'mysecret', user_id: null });

    const result = await app.service('secrets').get(id, params(adminUser));
    expect(result.id).toBe(id);
    expect(result.key).toBe('MY_KEY');
    expect(result.value).toBeUndefined();
    expect(result.safeValue).toMatch(/•/);
  });

  it('non-admin cannot get a global secret', async () => {
    const [id] = await db('secrets').insert({ key: 'MY_KEY', value: 'mysecret', user_id: null });
    await expectForbidden(app.service('secrets').get(id, params(regularUser)));
  });

  it('unauthenticated get is rejected', async () => {
    const [id] = await db('secrets').insert({ key: 'MY_KEY', value: 'mysecret', user_id: null });
    await expect(app.service('secrets').get(id, unauthParams)).rejects.toThrow('Not authenticated');
  });
});

describe('Secrets service - patch', () => {
  it('admin can patch a global secret', async () => {
    const [id] = await db('secrets').insert({
      key: 'PATCH_KEY',
      value: 'original',
      user_id: null,
    });

    const result = await app.service('secrets').patch(id, { value: 'updated' }, params(adminUser));
    expect(result.id).toBe(id);
    const row = await db('secrets').where({ id }).first();
    expect(row.value).toBe('updated');
  });

  it('non-admin cannot patch a global secret', async () => {
    const [id] = await db('secrets').insert({
      key: 'PATCH_KEY',
      value: 'original',
      user_id: null,
    });
    await expectForbidden(
      app.service('secrets').patch(id, { value: 'updated' }, params(regularUser))
    );
  });

  it('non-admin can patch own personal secret', async () => {
    const [id] = await db('secrets').insert({
      key: 'PERSONAL',
      value: 'original',
      user_id: regularUser.id,
    });
    await app.service('secrets').patch(id, { value: 'updated' }, params(regularUser));
    const row = await db('secrets').where({ id }).first();
    expect(row.value).toBe('updated');
  });

  it('unauthenticated patch is rejected', async () => {
    const [id] = await db('secrets').insert({
      key: 'PATCH_KEY',
      value: 'original',
      user_id: null,
    });
    await expect(
      app.service('secrets').patch(id, { value: 'updated' }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });
});

describe('Secrets service - remove', () => {
  it('admin can delete a global secret', async () => {
    const [id] = await db('secrets').insert({ key: 'TO_DELETE', value: 'val', user_id: null });

    await app.service('secrets').remove(id, params(adminUser));

    const row = await db('secrets').where({ id }).first();
    expect(row).toBeUndefined();
  });

  it('non-admin cannot delete a global secret', async () => {
    const [id] = await db('secrets').insert({ key: 'PROTECTED', value: 'val', user_id: null });

    await expectForbidden(app.service('secrets').remove(id, params(regularUser)));
  });

  it('non-admin can delete own personal secret', async () => {
    const [id] = await db('secrets').insert({
      key: 'PERSONAL',
      value: 'val',
      user_id: regularUser.id,
    });
    await app.service('secrets').remove(id, params(regularUser));
    expect(await db('secrets').where({ id }).first()).toBeUndefined();
  });

  it('unauthenticated remove is rejected', async () => {
    const [id] = await db('secrets').insert({
      key: 'ALSO_PROTECTED',
      value: 'val',
      user_id: null,
    });

    await expect(app.service('secrets').remove(id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});
