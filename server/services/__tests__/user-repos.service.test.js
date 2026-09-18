/**
 * Integration tests for the user-repos Feathers service.
 * Verifies that anthropic_api_key is encrypted at rest, masked for external callers,
 * and returned as plaintext for internal (no-provider) callers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerUserReposService } from '../feathers/user-repos.service.js';

const db = createTestDb({ beforeEach, afterEach });

const params = (user) => ({ provider: 'rest', user });
const internal = (user) => ({ user }); // no provider → plaintext secrets

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerUserReposService(app);
  return app;
}

let app;
let user1;
let user2;
let repo;
let userRepo1;

beforeEach(async () => {
  await db('users').insert([
    { github_id: 1, username: 'alice', approved: true },
    { github_id: 2, username: 'bob', approved: true },
  ]);
  user1 = await db('users').where({ username: 'alice' }).first();
  user2 = await db('users').where({ username: 'bob' }).first();

  const [repoId] = await db('repos').insert({
    full_name: 'alice/myrepo',
    stripped_name: 'alice-myrepo',
    bare_path: '/nonexistent',
  });
  repo = await db('repos').where({ id: repoId }).first();

  const [urId] = await db('user_repos').insert({ user_id: user1.id, repo_id: repo.id });
  userRepo1 = await db('user_repos').where({ id: urId }).first();

  app = makeApp(db);
  await app.setup();
});

describe('UserRepos service - find', () => {
  it('returns rows scoped to the requesting user', async () => {
    const result = await app.service('user-repos').find(params(user1));
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].user_id).toBe(user1.id);
  });

  it('does not return rows for other users', async () => {
    const result = await app.service('user-repos').find(params(user2));
    expect(result).toHaveLength(0);
  });

  it('returns anthropic_api_key: null when not set', async () => {
    const result = await app.service('user-repos').find(params(user1));
    expect(result[0].anthropic_api_key).toBeNull();
    expect(result[0].anthropic_api_key_encrypted).toBeUndefined();
  });

  it('unauthenticated find is rejected', async () => {
    await expect(app.service('user-repos').find({ provider: 'rest' })).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('UserRepos service - patch (encrypt + mask)', () => {
  it('stores anthropic_api_key encrypted', async () => {
    await app
      .service('user-repos')
      .patch(userRepo1.id, { anthropic_api_key: 'sk-ant-abc123' }, params(user1));
    const row = await db('user_repos').where({ id: userRepo1.id }).first();
    expect(row.anthropic_api_key_encrypted).toBeTruthy();
    expect(row.anthropic_api_key_encrypted).not.toBe('sk-ant-abc123');
  });

  it('returns masked anthropic_api_key for external callers', async () => {
    const result = await app
      .service('user-repos')
      .patch(userRepo1.id, { anthropic_api_key: 'sk-ant-abc123456' }, params(user1));
    expect(result.anthropic_api_key).toBeTruthy();
    expect(result.anthropic_api_key).not.toBe('sk-ant-abc123456');
    expect(result.anthropic_api_key_encrypted).toBeUndefined();
  });

  it('returns plaintext anthropic_api_key for internal callers (no provider)', async () => {
    await app
      .service('user-repos')
      .patch(userRepo1.id, { anthropic_api_key: 'sk-ant-abc123456' }, params(user1));
    const result = await app.service('user-repos').get(userRepo1.id, internal(user1));
    expect(result.anthropic_api_key).toBe('sk-ant-abc123456');
    expect(result.anthropic_api_key_encrypted).toBeUndefined();
  });

  it('clears the key when patched with empty string', async () => {
    await app
      .service('user-repos')
      .patch(userRepo1.id, { anthropic_api_key: 'sk-ant-abc123' }, params(user1));
    await app.service('user-repos').patch(userRepo1.id, { anthropic_api_key: '' }, params(user1));
    const row = await db('user_repos').where({ id: userRepo1.id }).first();
    expect(row.anthropic_api_key_encrypted).toBeNull();
    const result = await app.service('user-repos').get(userRepo1.id, internal(user1));
    expect(result.anthropic_api_key).toBeNull();
  });

  it('unauthenticated patch is rejected', async () => {
    await expect(
      app
        .service('user-repos')
        .patch(userRepo1.id, { anthropic_api_key: 'x' }, { provider: 'rest' })
    ).rejects.toThrow('Not authenticated');
  });

  it('patch succeeds when the user has multiple linked repos (params.knex + post-patch find)', async () => {
    const [repo2Id] = await db('repos').insert({
      full_name: 'alice/other',
      stripped_name: 'alice-other',
      bare_path: '/nonexistent2',
    });
    await db('user_repos').insert({ user_id: user1.id, repo_id: repo2Id });

    const result = await app
      .service('user-repos')
      .patch(userRepo1.id, { anthropic_api_key: 'sk-ant-multi' }, params(user1));
    expect(result.id).toBe(userRepo1.id);
    expect(result.anthropic_api_key).toBeTruthy();
  });
});

describe('UserRepos service - get', () => {
  it('returns the row for the owning user', async () => {
    const result = await app.service('user-repos').get(userRepo1.id, params(user1));
    expect(result.id).toBe(userRepo1.id);
    expect(result.user_id).toBe(user1.id);
  });

  it('unauthenticated get is rejected', async () => {
    await expect(app.service('user-repos').get(userRepo1.id, { provider: 'rest' })).rejects.toThrow(
      'Not authenticated'
    );
  });
});
