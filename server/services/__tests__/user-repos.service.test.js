/**
 * Integration tests for the user-repos Feathers service.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerUserReposService } from '../feathers/user-repos.service.js';
import { mountAgentConfigs } from '../../test-utils/agent-sdks.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';

vi.mock('../anthropic-models.js', () => ({
  listModels: vi.fn().mockResolvedValue([{ id: 'sonnet', display_name: 'Sonnet' }]),
  modelsCacheKey: vi.fn((url) => `anthropic-models:${url ?? 'default'}`),
}));
vi.mock('../../lib/cache.js', () => ({
  fetch: (_key, _ttl, fn) => fn(),
  clear: vi.fn(async () => {}),
  clearByPrefix: vi.fn(async () => {}),
}));

const db = createTestDb({ beforeEach, afterEach });

const params = (user) => ({ provider: 'rest', user });

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  mountAgentConfigs(app);
  app.service('agent-configs').registerSdk({
    key: 'claude',
    label: 'Claude',
    service_path: 'claude-agent',
  });
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
    repo_path: '/nonexistent',
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

  it('unauthenticated find is rejected', async () => {
    await expect(app.service('user-repos').find({ provider: 'rest' })).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('UserRepos service - show_in_all_sessions', () => {
  it('defaults to true for new links', async () => {
    const row = await db('user_repos').where({ id: userRepo1.id }).first();
    expect(row.show_in_all_sessions).toBe(1);
  });

  it('can be turned off via patch', async () => {
    await app
      .service('user-repos')
      .patch(userRepo1.id, { show_in_all_sessions: false }, params(user1));
    const row = await db('user_repos').where({ id: userRepo1.id }).first();
    expect(row.show_in_all_sessions).toBe(0);
  });
});

describe('UserRepos service - patch agent defaults', () => {
  it('stores agent_default_config_id and model on the link', async () => {
    const configId = await insertTestAgentConfig(db, user1.id);
    const result = await app.service('user-repos').patch(
      userRepo1.id,
      {
        agent_default_config_id: configId,
        agent_default_model: { model: 'sonnet', model_params: null },
      },
      params(user1)
    );
    expect(result.agent_default_config_id).toBe(configId);
    expect(result.agent_default_model).toEqual({ model: 'sonnet', model_params: null });
  });
});

describe('UserRepos service - patch prompts', () => {
  it('stores agent_prompt on the link', async () => {
    const result = await app
      .service('user-repos')
      .patch(userRepo1.id, { agent_prompt: 'Be concise.' }, params(user1));
    expect(result.agent_prompt).toBe('Be concise.');
  });

  it('rejects credential fields', async () => {
    await expect(
      app
        .service('user-repos')
        .patch(userRepo1.id, { anthropic_api_key: 'sk-ant-abc123' }, params(user1))
    ).rejects.toThrow();
  });

  it('patch succeeds when the user has multiple linked repos (params.knex + post-patch find)', async () => {
    const [repo2Id] = await db('repos').insert({
      full_name: 'alice/other',
      stripped_name: 'alice-other',
      repo_path: '/nonexistent2',
    });
    await db('user_repos').insert({ user_id: user1.id, repo_id: repo2Id });

    const result = await app
      .service('user-repos')
      .patch(userRepo1.id, { review_prompt: 'Review carefully.' }, params(user1));
    expect(result.id).toBe(userRepo1.id);
    expect(result.review_prompt).toBe('Review carefully.');
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
