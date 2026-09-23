import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerUsersService } from '../feathers/users.service.js';
import { registerUserReposService } from '../feathers/user-repos.service.js';
import { isClaudeOAuthToken, buildClaudeEnvFromPlainUser, getClaudeEnv } from '../session-env.js';

const HOST_API = 'host-api-key';
const HOST_AUTH = 'host-auth-token';
const HOST_OAUTH = 'host-oauth-token';
const USER = { username: 'alice', github_id: 1 };

describe('isClaudeOAuthToken', () => {
  it('detects setup-token OAuth prefixes', () => {
    expect(isClaudeOAuthToken('sk-ant-oat01-abc')).toBe(true);
    expect(isClaudeOAuthToken('sk-ant-oat-xyz')).toBe(true);
  });

  it('treats Console API keys and empty values as non-OAuth', () => {
    expect(isClaudeOAuthToken('sk-ant-api03-abc')).toBe(false);
    expect(isClaudeOAuthToken('sk-ant-abc123')).toBe(false);
    expect(isClaudeOAuthToken('')).toBe(false);
    expect(isClaudeOAuthToken(null)).toBe(false);
    expect(isClaudeOAuthToken(undefined)).toBe(false);
  });
});

describe('buildClaudeEnvFromPlainUser', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', HOST_API);
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', HOST_AUTH);
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', HOST_OAUTH);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('inherits host Claude auth when no user credential is set', () => {
    const env = buildClaudeEnvFromPlainUser(USER, null);
    expect(env.ANTHROPIC_API_KEY).toBe(HOST_API);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(HOST_AUTH);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(HOST_OAUTH);
  });

  it('sets ANTHROPIC_API_KEY for Console keys and strips other Claude auth env', () => {
    const env = buildClaudeEnvFromPlainUser(USER, 'sk-ant-api03-user');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-api03-user');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it('sets CLAUDE_CODE_OAUTH_TOKEN for oat tokens and strips API key env', () => {
    const env = buildClaudeEnvFromPlainUser(USER, 'sk-ant-oat01-user');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-user');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
});

const db = createTestDb({ beforeEach, afterEach });

describe('getClaudeEnv repo override', () => {
  let app;
  let user;
  let repo;

  beforeEach(async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', HOST_API);
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', HOST_OAUTH);

    await db('users').insert({ github_id: 1, username: 'alice', approved: true });
    user = await db('users').where({ username: 'alice' }).first();

    const [repoId] = await db('repos').insert({
      full_name: 'alice/myrepo',
      stripped_name: 'alice-myrepo',
      bare_path: '/nonexistent',
    });
    repo = await db('repos').where({ id: repoId }).first();
    await db('user_repos').insert({ user_id: user.id, repo_id: repo.id });

    app = feathers();
    app.set('db', db);
    registerUsersService(app);
    registerUserReposService(app);
    await app.setup();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the user credential when the repo has none', async () => {
    await app.service('users').patch(user.id, { anthropic_api_key: 'sk-ant-oat01-user' }, { user });
    const env = await getClaudeEnv(app, user.id, 'alice/myrepo');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-user');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('lets a repo API key override a user OAuth token', async () => {
    await app.service('users').patch(user.id, { anthropic_api_key: 'sk-ant-oat01-user' }, { user });
    const userRepos = await app.service('user-repos').find({
      query: { repo_id: repo.id },
      user,
      paginate: false,
    });
    await app
      .service('user-repos')
      .patch(userRepos[0].id, { anthropic_api_key: 'sk-ant-api03-repo' }, { user });

    const env = await getClaudeEnv(app, user.id, 'alice/myrepo');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-api03-repo');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });
});
