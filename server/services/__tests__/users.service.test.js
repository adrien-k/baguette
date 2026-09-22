/**
 * Integration tests for the users Feathers service.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerUsersService } from '../feathers/users.service.js';

const db = createTestDb({ beforeEach, afterEach });

const params = (user) => ({ provider: 'rest', user });
const unauthParams = { provider: 'rest' };

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerUsersService(app);
  return app;
}

let app;
let user1;
let user2;
let pendingUser;

beforeEach(async () => {
  await db('users').insert([
    { github_id: 1, username: 'alice', approved: true },
    { github_id: 2, username: 'bob', approved: true },
    { github_id: 3, username: 'charlie', approved: false },
  ]);
  user1 = await db('users').where({ username: 'alice' }).first();
  user2 = await db('users').where({ username: 'bob' }).first();
  pendingUser = await db('users').where({ username: 'charlie' }).first();

  app = makeApp(db);
  await app.setup();
});

describe('Users service - find', () => {
  it('any authenticated user can list all users', async () => {
    const result = await app.service('users').find(params(user1));
    const data = result.data ?? result;
    expect(data.length).toBeGreaterThanOrEqual(3);
  });

  it('unauthenticated find is rejected', async () => {
    await expect(app.service('users').find(unauthParams)).rejects.toThrow('Not authenticated');
  });

  it('results are ordered by created_at desc', async () => {
    const result = await app.service('users').find(params(user1));
    const data = result.data ?? result;
    for (let i = 1; i < data.length; i++) {
      expect(new Date(data[i - 1].created_at) >= new Date(data[i].created_at)).toBe(true);
    }
  });
});

describe('Users service - approve', () => {
  it('any authenticated user can approve a pending user', async () => {
    await app.service('users').approve(pendingUser.id, params(user1));

    const updated = await db('users').where({ id: pendingUser.id }).first();
    expect(updated.approved).toBe(1); // SQLite stores booleans as 0/1
  });

  it('unauthenticated approve is rejected', async () => {
    await expect(app.service('users').approve(pendingUser.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('Users service - reject', () => {
  it('any authenticated user can reject (revoke) an approved user', async () => {
    await app.service('users').reject(user2.id, params(user1));

    const updated = await db('users').where({ id: user2.id }).first();
    expect(updated.approved).toBe(0);
  });

  it('unauthenticated reject is rejected', async () => {
    await expect(app.service('users').reject(pendingUser.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('Users service - get', () => {
  it('any authenticated user can get a user by id', async () => {
    const result = await app.service('users').get(user2.id, params(user1));
    expect(result.id).toBe(user2.id);
    expect(result.username).toBe('bob');
  });

  it('unauthenticated get is rejected', async () => {
    await expect(app.service('users').get(user1.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('Users service - create', () => {
  it('any authenticated user can create a new user', async () => {
    const result = await app
      .service('users')
      .create({ github_id: 999, username: 'newuser', approved: false }, params(user1));
    expect(result.username).toBe('newuser');
    const row = await db('users').where({ username: 'newuser' }).first();
    expect(row).toBeTruthy();
  });

  it('unauthenticated create is rejected', async () => {
    await expect(
      app.service('users').create({ github_id: 999, username: 'newuser' }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });
});

describe('Users service - patch', () => {
  it('a user can patch themselves', async () => {
    const result = await app
      .service('users')
      .patch(user1.id, { model: 'claude-opus-4-6' }, params(user1));
    expect(result.model).toBe('claude-opus-4-6');
  });

  it('stores and returns cursor fast/effort in agent_preferences', async () => {
    const result = await app
      .service('users')
      .patch(
        user1.id,
        { agent_preferences: { cursor_fast: 'yes', cursor_effort: 'high' } },
        params(user1)
      );
    expect(result.agent_preferences).toEqual({ cursor_fast: 'yes', cursor_effort: 'high' });
    const row = await db('users').where({ id: user1.id }).first();
    expect(JSON.parse(row.agent_preferences)).toEqual({
      cursor_fast: 'yes',
      cursor_effort: 'high',
    });
  });

  it('merges partial agent_preferences patches', async () => {
    await app
      .service('users')
      .patch(
        user1.id,
        { agent_preferences: { cursor_fast: 'no', cursor_effort: 'low' } },
        params(user1)
      );
    const result = await app
      .service('users')
      .patch(user1.id, { agent_preferences: { cursor_effort: 'xhigh' } }, params(user1));
    expect(result.agent_preferences).toEqual({ cursor_fast: 'no', cursor_effort: 'xhigh' });
  });

  it('a user cannot patch another user', async () => {
    await expect(
      app.service('users').patch(user2.id, { approved: false }, params(user1))
    ).rejects.toThrow('Can only patch own user');
  });

  it('unauthenticated patch is rejected', async () => {
    await expect(
      app.service('users').patch(user2.id, { approved: false }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });

  it('encrypts access_token on patch', async () => {
    await app.service('users').patch(user1.id, { access_token: 'ghu_testtoken' }, {}); // internal
    const row = await db('users').where({ id: user1.id }).first();
    expect(row.access_token_encrypted).toBeTruthy();
    expect(row.access_token_encrypted).not.toBe('ghu_testtoken');
  });

  it('never exposes access_token to external calls', async () => {
    await app.service('users').patch(user1.id, { access_token: 'ghu_testtoken123' }, {});
    const result = await app.service('users').get(user1.id, params(user1));
    expect(result.access_token).toBeUndefined();
    expect(result.access_token_encrypted).toBeUndefined();
  });

  it('returns decrypted access_token for internal calls (no provider)', async () => {
    await app.service('users').patch(user1.id, { access_token: 'ghu_testtoken123' }, {});
    const result = await app.service('users').get(user1.id, { user: user1 }); // no provider = internal
    expect(result.access_token).toBe('ghu_testtoken123');
    expect(result.access_token_encrypted).toBeUndefined();
  });

  it('encrypts anthropic_api_key on patch', async () => {
    await app
      .service('users')
      .patch(user1.id, { anthropic_api_key: 'sk-ant-test123' }, params(user1));
    const row = await db('users').where({ id: user1.id }).first();
    expect(row.anthropic_api_key_encrypted).toBeTruthy();
    expect(row.anthropic_api_key_encrypted).not.toBe('sk-ant-test123');
  });

  it('returns masked anthropic_api_key for external calls', async () => {
    await app
      .service('users')
      .patch(user1.id, { anthropic_api_key: 'sk-ant-test123456' }, params(user1));
    const result = await app.service('users').get(user1.id, params(user1));
    expect(result.anthropic_api_key).toBeTruthy();
    expect(result.anthropic_api_key).not.toBe('sk-ant-test123456');
    expect(result.anthropic_api_key_encrypted).toBeUndefined();
  });

  it('returns plaintext anthropic_api_key for internal calls (no provider)', async () => {
    await app
      .service('users')
      .patch(user1.id, { anthropic_api_key: 'sk-ant-test123456' }, params(user1));
    const result = await app.service('users').get(user1.id, { user: user1 });
    expect(result.anthropic_api_key).toBe('sk-ant-test123456');
    expect(result.anthropic_api_key_encrypted).toBeUndefined();
  });

  it('encrypts access_token on patch', async () => {
    await app.service('users').patch(user1.id, { access_token: 'gho_testtoken' }, params(user1));
    const row = await db('users').where({ id: user1.id }).first();
    expect(row.access_token_encrypted).toBeTruthy();
    expect(row.access_token_encrypted).not.toBe('gho_testtoken');
    expect(row.access_token).toBeUndefined();
  });

  it('hides access_token from external callers', async () => {
    await app.service('users').patch(user1.id, { access_token: 'gho_testtoken' }, params(user1));
    const result = await app.service('users').get(user1.id, params(user1));
    expect(result.access_token).toBeUndefined();
    expect(result.access_token_encrypted).toBeUndefined();
  });

  it('returns plaintext access_token for internal calls (no provider)', async () => {
    await app.service('users').patch(user1.id, { access_token: 'gho_testtoken' }, params(user1));
    const result = await app.service('users').get(user1.id, { user: user1 });
    expect(result.access_token).toBe('gho_testtoken');
    expect(result.access_token_encrypted).toBeUndefined();
  });
});

describe('Users service - remove', () => {
  it('any authenticated user can remove a user', async () => {
    await app.service('users').remove(pendingUser.id, params(user1));
    const row = await db('users').where({ id: pendingUser.id }).first();
    expect(row).toBeUndefined();
  });

  it('unauthenticated remove is rejected', async () => {
    await expect(app.service('users').remove(pendingUser.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});
