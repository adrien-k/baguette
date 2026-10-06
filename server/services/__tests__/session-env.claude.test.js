import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerUsersService } from '../feathers/users.service.js';
import { registerUserReposService } from '../feathers/user-repos.service.js';
import {
  normalizeAnthropicBaseUrl,
  buildClaudeEnvFromPlainUser,
  getClaudeEnv,
  isAnthropicClaudeModelId,
  applyClaudeAgentModelEnv,
} from '../session-env.js';

const HOST_API = 'host-api-key';
const HOST_AUTH = 'host-auth-token';
const HOST_OAUTH = 'host-oauth-token';
const HOST_BASE_URL = 'https://api.anthropic.com';
const USER = { username: 'alice', github_id: 1 };

describe('isAnthropicClaudeModelId', () => {
  it('treats native Claude ids and CLI aliases as Anthropic', () => {
    expect(isAnthropicClaudeModelId('claude-opus-5')).toBe(true);
    expect(isAnthropicClaudeModelId('sonnet')).toBe(true);
    expect(isAnthropicClaudeModelId('Haiku')).toBe(true);
    expect(isAnthropicClaudeModelId(null)).toBe(true);
    expect(isAnthropicClaudeModelId('')).toBe(true);
  });

  it('treats gateway third-party ids as non-Anthropic', () => {
    expect(isAnthropicClaudeModelId('gpt-4o')).toBe(false);
    expect(isAnthropicClaudeModelId('openai/gpt-4.1')).toBe(false);
  });
});

describe('applyClaudeAgentModelEnv', () => {
  it('sets default opus/sonnet env vars for non-Anthropic models', () => {
    const base = { ANTHROPIC_API_KEY: 'k' };
    const env = applyClaudeAgentModelEnv(base, 'gpt-4o');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-4o');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('gpt-4o');
    expect(env.ANTHROPIC_API_KEY).toBe('k');
  });

  it('leaves env unchanged for Anthropic models', () => {
    const base = { ANTHROPIC_API_KEY: 'k' };
    expect(applyClaudeAgentModelEnv(base, 'claude-sonnet-4-5')).toBe(base);
    expect(applyClaudeAgentModelEnv(base, 'opus')).toBe(base);
    expect(applyClaudeAgentModelEnv(base, null)).toBe(base);
  });
});

describe('normalizeAnthropicBaseUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeAnthropicBaseUrl('  https://gateway.example.com/  ')).toBe(
      'https://gateway.example.com'
    );
  });

  it('returns null for empty values', () => {
    expect(normalizeAnthropicBaseUrl('')).toBeNull();
    expect(normalizeAnthropicBaseUrl('   ')).toBeNull();
    expect(normalizeAnthropicBaseUrl(null)).toBeNull();
  });
});

describe('buildClaudeEnvFromPlainUser', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', HOST_API);
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', HOST_AUTH);
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', HOST_OAUTH);
    vi.stubEnv('ANTHROPIC_BASE_URL', HOST_BASE_URL);
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

  it('maps the API key field to ANTHROPIC_API_KEY without touching the other auth vars', () => {
    const env = buildClaudeEnvFromPlainUser(USER, 'sk-ant-oat01-legacy-token');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-oat01-legacy-token');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(HOST_AUTH);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(HOST_OAUTH);
  });

  it('maps the auth token field to ANTHROPIC_AUTH_TOKEN without touching the other auth vars', () => {
    const env = buildClaudeEnvFromPlainUser(USER, null, null, {
      anthropicAuthToken: 'gw-bearer-token',
    });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('gw-bearer-token');
    expect(env.ANTHROPIC_API_KEY).toBe(HOST_API);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(HOST_OAUTH);
  });

  it('applies both credentials independently when both are set', () => {
    const env = buildClaudeEnvFromPlainUser(USER, 'sk-ant-api03-user', null, {
      anthropicAuthToken: 'gw-bearer-token',
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-api03-user');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('gw-bearer-token');
  });

  it('does not touch host auth env when neither credential kind is set', () => {
    const env = buildClaudeEnvFromPlainUser(USER, null, null, {});
    expect(env.ANTHROPIC_API_KEY).toBe(HOST_API);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(HOST_AUTH);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(HOST_OAUTH);
  });

  it('inherits host ANTHROPIC_BASE_URL when none is configured', () => {
    const env = buildClaudeEnvFromPlainUser(USER, null);
    expect(env.ANTHROPIC_BASE_URL).toBe(HOST_BASE_URL);
  });

  it('overrides host ANTHROPIC_BASE_URL when a custom base URL is set', () => {
    const env = buildClaudeEnvFromPlainUser(USER, null, 'https://llm-gateway.example.com/');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://llm-gateway.example.com');
  });

  it('leaves gateway discovery env vars to the host environment', () => {
    vi.stubEnv('CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY', '1');
    const env = buildClaudeEnvFromPlainUser(USER, 'sk-ant-api03-user', null, {});
    expect(env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).toBe('1');

    const plain = buildClaudeEnvFromPlainUser(USER, null);
    expect(plain.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).toBe('1');
  });

  it('ignores removed legacy fields on the options object', () => {
    const env = buildClaudeEnvFromPlainUser(USER, 'sk-ant-api03-user', null, {
      claudeDefaultModel: 'legacy-model',
      gatewayModelDiscovery: true,
    });
    expect(env.ANTHROPIC_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBeUndefined();
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
    await app
      .service('users')
      .patch(user.id, { anthropic_auth_token: 'sk-ant-oat01-user' }, { user });
    const env = await getClaudeEnv(app, user.id, 'alice/myrepo');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-ant-oat01-user');
    expect(env.ANTHROPIC_API_KEY).toBe(HOST_API); // host env inherited, not stripped
  });

  it('applies repo-level and account-level credentials independently', async () => {
    await app
      .service('users')
      .patch(user.id, { anthropic_auth_token: 'sk-ant-oat01-user' }, { user });
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
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-ant-oat01-user');
  });

  it('maps a legacy setup-token value in the API key field to ANTHROPIC_API_KEY', async () => {
    await app
      .service('users')
      .patch(user.id, { anthropic_api_key: 'sk-ant-oat01-legacy' }, { user });
    const env = await getClaudeEnv(app, user.id, 'alice/myrepo');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-oat01-legacy');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(HOST_OAUTH); // inherited, untouched
  });

  it('lets a repo base URL override the account default', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', HOST_BASE_URL);
    await app
      .service('users')
      .patch(user.id, { anthropic_base_url: 'https://account-gateway.example.com' }, { user });
    const userRepos = await app.service('user-repos').find({
      query: { repo_id: repo.id },
      user,
      paginate: false,
    });
    await app
      .service('user-repos')
      .patch(
        userRepos[0].id,
        { anthropic_base_url: 'https://repo-gateway.example.com/' },
        { user }
      );

    const env = await getClaudeEnv(app, user.id, 'alice/myrepo');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://repo-gateway.example.com');
  });

  it('encrypts the repo auth token and uses it for the session env', async () => {
    await app.service('users').patch(user.id, { anthropic_auth_token: 'account-token' }, { user });
    const env1 = await getClaudeEnv(app, user.id, 'alice/myrepo');
    expect(env1.ANTHROPIC_AUTH_TOKEN).toBe('account-token');

    const userRepos = await app.service('user-repos').find({
      query: { repo_id: repo.id },
      user,
      paginate: false,
    });
    await app
      .service('user-repos')
      .patch(userRepos[0].id, { anthropic_auth_token: 'repo-token' }, { user });

    const row = await db('user_repos').where({ id: userRepos[0].id }).first();
    expect(row.anthropic_auth_token_encrypted).toBeTruthy();
    expect(row.anthropic_auth_token_encrypted).not.toBe('repo-token');

    const env2 = await getClaudeEnv(app, user.id, 'alice/myrepo');
    expect(env2.ANTHROPIC_AUTH_TOKEN).toBe('repo-token');
    expect(env2.ANTHROPIC_API_KEY).toBe(HOST_API); // host env inherited, not stripped
  });

  it('does not set gateway discovery env vars in the session env', async () => {
    const env = await getClaudeEnv(app, user.id, 'alice/myrepo');
    expect(env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).toBeUndefined();
  });

  it('ignores legacy default model / discovery fields in patches', async () => {
    await app.service('users').patch(
      user.id,
      {
        claude_default_model: 'account-model',
        claude_gateway_model_discovery: true,
        color_scheme: 'light',
      },
      { user }
    );
    const row = await db('users').where({ id: user.id }).first();
    expect(row.claude_default_model).toBeUndefined();
    expect(row.claude_gateway_model_discovery).toBeUndefined();
    const env = await getClaudeEnv(app, user.id, 'alice/myrepo');
    expect(env.ANTHROPIC_MODEL).toBeUndefined();
  });
});
