/**
 * Integration tests for the users Feathers service.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';

const mockClearUserReposPickerCache = vi.fn();
vi.mock('../../agent-sdks/claude/anthropic-models.js', () => ({
  listModels: vi.fn().mockResolvedValue({
    models: [{ id: 'sonnet', display_name: 'Sonnet' }],
    rejected_models: [],
  }),
  modelsCacheKey: vi.fn((url) => `anthropic-models:${url ?? 'default'}`),
}));
vi.mock('../../lib/cache.js', () => ({
  fetch: (_key, _ttl, fn) => fn(),
  clear: vi.fn(async () => {}),
  clearByPrefix: vi.fn(async () => {}),
}));
vi.mock('../github.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    clearUserReposPickerCache: (...args) => {
      mockClearUserReposPickerCache(...args);
      return actual.clearUserReposPickerCache(...args);
    },
  };
});

const githubConfigMock = vi.hoisted(() => ({ configured: false }));
vi.mock('../../lib/instance-settings.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getGithubAppConfig: vi.fn(async () => ({ configured: githubConfigMock.configured })),
  };
});

import { registerUsersService } from '../feathers/users.service.js';
import { mountAgentConfigs } from '../../test-utils/agent-sdks.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';

const db = createTestDb();

const params = (user) => ({ provider: 'rest', user });
const setAdminParams = (user, targetUserId) => ({
  provider: 'rest',
  user,
  route: { id: targetUserId },
});
const unauthParams = { provider: 'rest' };

function expectForbidden(promise) {
  return expect(promise).rejects.toThrow(
    /Admin required|Forbidden|Not allowed|Cannot demote|Cannot revoke|Cannot delete/
  );
}

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  mountAgentConfigs(app);
  app.service('agent-configs').registerSdk({
    key: 'claude',
    label: 'Claude',
    service_path: 'claude-agent',
  });
  registerUsersService(app);
  return app;
}

let app;
let user1;
let user2;
let pendingUser;

beforeEach(async () => {
  githubConfigMock.configured = false;
  await db('users').insert([
    { github_id: 1, username: 'alice', status: 'approved', admin: 1 },
    { github_id: 2, username: 'bob', status: 'approved', admin: 0 },
    { github_id: 3, username: 'charlie', status: 'pending', admin: 0 },
  ]);
  user1 = await db('users').where({ username: 'alice' }).first();
  user2 = await db('users').where({ username: 'bob' }).first();
  pendingUser = await db('users').where({ username: 'charlie' }).first();

  app = makeApp(db);
  await app.setup();
});

describe('Users service - find', () => {
  it('admin can list all users', async () => {
    const result = await app.service('users').find(params(user1));
    const data = result.data ?? result;
    expect(data.length).toBeGreaterThanOrEqual(3);
  });

  it('non-admin cannot list users', async () => {
    await expectForbidden(app.service('users').find(params(user2)));
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

  it('exposes status and a derived approved boolean on external finds', async () => {
    await app.service('users').reject(user2.id, params(user1));
    const result = await app.service('users').find(params(user1));
    const data = result.data ?? result;
    const bob = data.find((u) => u.username === 'bob');
    const charlie = data.find((u) => u.username === 'charlie');
    expect(bob.status).toBe('revoked');
    expect(bob.approved).toBe(false);
    expect(bob.revoked).toBeUndefined();
    expect(charlie.status).toBe('pending');
    expect(charlie.approved).toBe(false);
  });
});

describe('Users service - approve', () => {
  it('admin can approve a pending user', async () => {
    await app.service('users').approve(pendingUser.id, params(user1));

    const updated = await db('users').where({ id: pendingUser.id }).first();
    expect(updated.status).toBe('approved');
  });

  it('approving a revoked user restores approved status', async () => {
    await app.service('users').reject(user2.id, params(user1));
    await app.service('users').approve(user2.id, params(user1));

    const updated = await db('users').where({ id: user2.id }).first();
    expect(updated.status).toBe('approved');
  });

  it('non-admin cannot approve', async () => {
    await expectForbidden(app.service('users').approve(pendingUser.id, params(user2)));
  });

  it('unauthenticated approve is rejected', async () => {
    await expect(app.service('users').approve(pendingUser.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('Users service - reject', () => {
  it('admin can reject (revoke) an approved user', async () => {
    await app.service('users').reject(user2.id, params(user1));

    const updated = await db('users').where({ id: user2.id }).first();
    expect(updated.status).toBe('revoked');
  });

  it('rejecting a pending user persists revoked instead of leaving them pending', async () => {
    await app.service('users').reject(pendingUser.id, params(user1));

    const updated = await db('users').where({ id: pendingUser.id }).first();
    expect(updated.status).toBe('revoked');
  });

  it('later profile patches do not clear a persisted revoked status', async () => {
    await app.service('users').reject(user2.id, params(user1));
    await app.service('users').patch(user2.id, { username: 'robert' }, {});

    const updated = await db('users').where({ id: user2.id }).first();
    expect(updated.username).toBe('robert');
    expect(updated.status).toBe('revoked');
  });

  it('ignores status on patch so a user cannot self-approve', async () => {
    await app.service('users').reject(user2.id, params(user1));
    await app
      .service('users')
      .patch(user2.id, { status: 'approved', username: 'robert' }, params(user2));

    const updated = await db('users').where({ id: user2.id }).first();
    expect(updated.username).toBe('robert');
    expect(updated.status).toBe('revoked');
  });

  it('non-admin cannot reject', async () => {
    await expectForbidden(app.service('users').reject(user2.id, params(user2)));
  });

  it('cannot reject the last admin', async () => {
    await expectForbidden(app.service('users').reject(user1.id, params(user1)));
  });

  it('unauthenticated reject is rejected', async () => {
    await expect(app.service('users').reject(pendingUser.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('Users service - get', () => {
  it('admin can get any user by id', async () => {
    const result = await app.service('users').get(user2.id, params(user1));
    expect(result.id).toBe(user2.id);
    expect(result.username).toBe('bob');
  });

  it('non-admin can get self only', async () => {
    const self = await app.service('users').get(user2.id, params(user2));
    expect(self.id).toBe(user2.id);
    await expectForbidden(app.service('users').get(user1.id, params(user2)));
  });

  it('external user payload includes admin as boolean', async () => {
    const adminView = await app.service('users').get(user1.id, params(user1));
    expect(adminView.admin).toBe(true);
    const self = await app.service('users').get(user2.id, params(user2));
    expect(self.admin).toBe(false);
  });

  it('unauthenticated get is rejected', async () => {
    await expect(app.service('users').get(user1.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('Users service - create', () => {
  it('admin can create a new user', async () => {
    const result = await app
      .service('users')
      .create({ github_id: 999, username: 'newuser', status: 'pending' }, params(user1));
    expect(result.username).toBe('newuser');
    const row = await db('users').where({ username: 'newuser' }).first();
    expect(row).toBeTruthy();
  });

  it('non-admin cannot create users', async () => {
    await expectForbidden(
      app
        .service('users')
        .create({ github_id: 999, username: 'newuser', status: 'pending' }, params(user2))
    );
  });

  it('unauthenticated create is rejected', async () => {
    await expect(
      app.service('users').create({ github_id: 999, username: 'newuser' }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });

  it('rejects an unrecognized status on create instead of coercing it', async () => {
    await expect(
      app
        .service('users')
        .create({ github_id: 998, username: 'badstatus', status: 'active' }, params(user1))
    ).rejects.toThrow('Invalid user status');
    const row = await db('users').where({ username: 'badstatus' }).first();
    expect(row).toBeFalsy();
  });

  it('keeps the legacy approved boolean mapped to status on create', async () => {
    const legacy = await app
      .service('users')
      .create({ github_id: 997, username: 'legacyapproved', approved: true }, params(user1));
    expect(legacy.status).toBe('approved');
  });
});

describe('Users service - patch', () => {
  it('a user can patch themselves', async () => {
    const result = await app
      .service('users')
      .patch(user1.id, { model: 'claude-opus-4-6' }, params(user1));
    expect(result.model).toBe('claude-opus-4-6');
  });

  it('persists color_scheme and normalizes invalid values to dark', async () => {
    const light = await app
      .service('users')
      .patch(user1.id, { color_scheme: 'light' }, params(user1));
    expect(light.color_scheme).toBe('light');

    const dark = await app
      .service('users')
      .patch(user1.id, { color_scheme: 'solarized' }, params(user1));
    expect(dark.color_scheme).toBe('dark');
  });

  it('stores and returns cursor fast/effort in agent_preferences', async () => {
    const result = await app
      .service('users')
      .patch(
        user1.id,
        { agent_preferences: { cursor_fast: 'yes', cursor_effort: 'high' } },
        params(user1)
      );
    expect(result.agent_preferences).toEqual({
      cursor_fast: 'yes',
      cursor_effort: 'high',
      cursor_thinking: 'default',
      cursor_reasoning: 'default',
      cursor_context: 'default',
      cursor_cyber: 'default',
    });
    const row = await db('users').where({ id: user1.id }).first();
    expect(JSON.parse(row.agent_preferences)).toEqual({
      cursor_fast: 'yes',
      cursor_effort: 'high',
      cursor_thinking: 'default',
      cursor_reasoning: 'default',
      cursor_context: 'default',
      cursor_cyber: 'default',
    });
  });

  it('generateMcpToken returns plaintext once and sets encrypted column', async () => {
    const result = await app.service('users').generateMcpToken(null, params(user1));
    expect(result.token).toMatch(/^bgmcp_/);
    expect(result.endpoint).toContain('/api/mcp');
    const row = await db('users').where({ id: user1.id }).first();
    expect(row.mcp_api_token_encrypted).toBeTruthy();
    const external = await app.service('users').get(user1.id, params(user1));
    expect(external.mcp_token_configured).toBe(true);
    expect(external.mcp_api_token).toBeTruthy();
    expect(external.mcp_api_token).not.toBe(result.token);
    expect(external.mcp_endpoint).toContain('/api/mcp');
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
    expect(result.agent_preferences).toEqual({
      cursor_fast: 'no',
      cursor_effort: 'xhigh',
      cursor_thinking: 'default',
      cursor_reasoning: 'default',
      cursor_context: 'default',
      cursor_cyber: 'default',
    });
  });

  it('a user cannot patch another user', async () => {
    await expect(
      app.service('users').patch(user2.id, { status: 'pending' }, params(user1))
    ).rejects.toThrow('Can only patch own user');
  });

  it('external patch cannot set admin', async () => {
    await app
      .service('users')
      .patch(user2.id, { admin: true, color_scheme: 'light' }, params(user2));
    const row = await db('users').where({ id: user2.id }).first();
    expect(row.admin).toBe(0);
    expect(row.color_scheme).toBe('light');
  });

  it('external patch cannot set github_id or status', async () => {
    await app
      .service('users')
      .patch(
        user2.id,
        { github_id: 99999, status: 'pending', color_scheme: 'light' },
        params(user2)
      );
    const row = await db('users').where({ id: user2.id }).first();
    expect(row.github_id).toBe(2);
    expect(row.status).toBe('approved');
    expect(row.color_scheme).toBe('light');
  });

  it('unauthenticated patch is rejected', async () => {
    await expect(
      app.service('users').patch(user2.id, { status: 'pending' }, unauthParams)
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

  it('encrypts github_token on patch and masks for external callers', async () => {
    await app
      .service('users')
      .patch(user1.id, { github_token: 'ghp_testpat123456' }, params(user1));
    const row = await db('users').where({ id: user1.id }).first();
    expect(row.github_token_encrypted).toBeTruthy();
    expect(row.github_token_encrypted).not.toBe('ghp_testpat123456');
    const external = await app.service('users').get(user1.id, params(user1));
    expect(external.github_token).toBeTruthy();
    expect(external.github_token).not.toBe('ghp_testpat123456');
    const internal = await app.service('users').get(user1.id, { user: user1 });
    expect(internal.github_token).toBe('ghp_testpat123456');
  });

  it('clears PAT repo-picker cache when github_token is patched', async () => {
    mockClearUserReposPickerCache.mockClear();
    await app
      .service('users')
      .patch(user1.id, { github_token: 'ghp_rotated123456' }, params(user1));
    expect(mockClearUserReposPickerCache).toHaveBeenCalledWith(`u${user1.id}`);
  });
});

describe('Users service - agent defaults patch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates default model against the selected agent config credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 'kimi-k3' }, { id: 'glm-5.3' }] }), {
            status: 200,
          })
      )
    );
    const configId = await insertTestAgentConfig(db, user1.id, {
      apiKey: 'sk-ant-api03-key',
      apiUrl: 'https://opencode.ai/zen/go',
      label: 'Claude GW',
    });
    const updated = await app.service('users').patch(
      user1.id,
      {
        agent_default_config_id: configId,
        agent_default_model: { model: 'kimi-k3' },
      },
      params(user1)
    );
    expect(updated.agent_default_model.model).toBe('kimi-k3');
    expect(updated.agent_default_config_id).toBe(configId);
  }, 15000);

  it('accepts any as the agent-created model policy and rejects unknown modes', async () => {
    const updated = await app
      .service('users')
      .patch(user1.id, { subagent_default_mode: 'any' }, params(user1));
    expect(updated.subagent_default_mode).toBe('any');
    expect(updated.subagent_default_config_id).toBeNull();
    await expect(
      app.service('users').patch(user1.id, { subagent_default_mode: 'free' }, params(user1))
    ).rejects.toThrow(/inherit, config, preset, or any/);
  });
});

describe('Users service - setAdmin', () => {
  it('non-admin cannot setAdmin', async () => {
    await expectForbidden(
      app.service('users').setAdmin({ admin: true }, setAdminParams(user2, user2.id))
    );
  });

  it('admin can promote another user', async () => {
    const updated = await app
      .service('users')
      .setAdmin({ admin: true }, setAdminParams(user1, user2.id));
    expect(updated.admin).toBe(true);
  });

  it('accepts id in the payload (REST client call)', async () => {
    const updated = await app
      .service('users')
      .setAdmin({ id: user2.id, admin: true }, params(user1));
    expect(updated.admin).toBe(true);
  });

  it('requires a target user id', async () => {
    await expect(app.service('users').setAdmin({ admin: true }, params(user1))).rejects.toThrow(
      'User id is required'
    );
  });

  it('cannot demote the last admin', async () => {
    await expectForbidden(
      app.service('users').setAdmin({ admin: false }, setAdminParams(user1, user1.id))
    );
  });
});

describe('Users service - remove', () => {
  it('admin can remove a user', async () => {
    await app.service('users').remove(pendingUser.id, params(user1));
    const row = await db('users').where({ id: pendingUser.id }).first();
    expect(row).toBeUndefined();
  });

  it('non-admin cannot remove users', async () => {
    await expectForbidden(app.service('users').remove(pendingUser.id, params(user2)));
  });

  it('unauthenticated remove is rejected', async () => {
    await expect(app.service('users').remove(pendingUser.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });

  it('cannot remove the last admin', async () => {
    await expectForbidden(app.service('users').remove(user1.id, params(user1)));
    expect(await db('users').where({ id: user1.id }).first()).toBeTruthy();
  });

  it('can remove an admin when another admin remains', async () => {
    await db('users').where({ id: user2.id }).update({ admin: 1 });
    await app.service('users').remove(user2.id, params(user1));
    expect(await db('users').where({ id: user2.id }).first()).toBeUndefined();
  });
});

describe('Users service - invite', () => {
  it('admin can create a one-time invite for a new username', async () => {
    const result = await app.service('users').invite({ username: 'dana' }, params(user1));
    expect(result.invite_url).toMatch(/\/invite\/bginv_/);
    expect(result.user).toMatchObject({
      username: 'dana',
      approved: true,
      admin: false,
      invite_pending: true,
    });
    const row = await db('users').where({ username: 'dana' }).first();
    expect(row.invite_token_hash).toBeTruthy();
    expect(row.status).toBe('approved');

    const listed = await app.service('users').get(row.id, params(user1));
    expect(listed.invite_pending).toBe(true);
    expect(listed.invite_token_hash).toBeUndefined();
  });

  it('regenerates the token for an unused invite', async () => {
    const first = await app.service('users').invite({ username: 'dana' }, params(user1));
    const second = await app.service('users').invite({ username: 'dana' }, params(user1));
    expect(second.invite_url).not.toBe(first.invite_url);
    expect(second.user.id).toBe(first.user.id);
  });

  it('rejects invites when the GitHub App is configured', async () => {
    githubConfigMock.configured = true;
    await expect(app.service('users').invite({ username: 'dana' }, params(user1))).rejects.toThrow(
      'Invites are only available when GitHub sign-in is not configured'
    );
  });

  it('non-admin cannot invite', async () => {
    await expectForbidden(app.service('users').invite({ username: 'dana' }, params(user2)));
  });

  it('rejects a username that already signs in', async () => {
    await expect(app.service('users').invite({ username: 'alice' }, params(user1))).rejects.toThrow(
      'That user already signs in with GitHub'
    );
  });
});
