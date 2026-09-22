/**
 * Integration tests for the repos Feathers service.
 *
 * - find: returns registered repos from DB with session_count and exists_on_fs
 * - findRemote: returns GitHub repos (mocked)
 * - branches: returns branches for a repo (mocked)
 * - create: registers a repo via ensureBareClone (mocked); revives soft-deleted repos
 * - remove: soft-deletes a repo and its active sessions
 * - configure: generates an onboarding prompt for a registered repo
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerReposService } from '../feathers/repos.service.js';
import { NotFound } from '@feathersjs/errors';

vi.mock('../agent-settings.js', () => ({
  getEffectiveGithubToken: vi.fn((user) => user?.access_token || null),
}));

// Lets individual tests flip between the legacy OAuth App flow and GitHub App ("app") mode.
const configMock = vi.hoisted(() => ({ authMode: 'oauth' }));
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    get GITHUB_AUTH_MODE() {
      return configMock.authMode;
    },
  };
});

vi.mock('../github.js', () => ({
  listUserRepos: vi.fn(),
  listUserOrgs: vi.fn(),
  listOrgRepos: vi.fn(),
  listUserInstallations: vi.fn(),
  listInstallationRepos: vi.fn(),
  cacheScopeForUser: vi.fn((user) => `u${user?.id}`),
  clearReposCache: vi.fn(),
  clearOrgsCache: vi.fn(),
  clearBranchesCache: vi.fn(),
  listBranches: vi.fn(),
  ensureBareClone: vi.fn(),
  toStrippedName: vi.fn(
    (name) =>
      name
        .replace(/\//g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'repo'
  ),
}));

import {
  listUserRepos,
  listUserOrgs,
  listOrgRepos,
  listUserInstallations,
  listInstallationRepos,
  clearReposCache,
  clearOrgsCache,
  clearBranchesCache,
  listBranches,
  ensureBareClone,
} from '../github.js';

const db = createTestDb({ beforeEach, afterEach });

const adminUser = { id: null, access_token: 'gh_token_admin' };
const regularUser = { id: null, access_token: 'gh_token_user' };
const params = (user) => ({ provider: 'rest', user });
const unauthParams = { provider: 'rest' };
/** Cache scope the service derives for a user (see cacheScopeForUser). */
const scope = (user = regularUser) => `u${user.id}`;

const removeByRepoId = vi.fn().mockResolvedValue(undefined);

/** `repos.find` scopes by user_repos; link alice to a repo id after inserting repos. */
function linkAliceToRepo(repoId) {
  return db('user_repos').insert({ user_id: regularUser.id, repo_id: repoId });
}

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  app.use('sessions', { removeByRepoId }, { methods: ['removeByRepoId'] });
  registerReposService(app);
  return app;
}

let app;

beforeEach(async () => {
  vi.clearAllMocks();

  await db('users').insert([
    { github_id: 1, username: 'admin', approved: true },
    { github_id: 2, username: 'alice', approved: true },
  ]);
  const admin = await db('users').where({ username: 'admin' }).first();
  const alice = await db('users').where({ username: 'alice' }).first();
  adminUser.id = admin.id;
  regularUser.id = alice.id;

  app = makeApp(db);
  await app.setup();
});

// ---------------------------------------------------------------------------
// find — registered repos from DB
// ---------------------------------------------------------------------------

describe('Repos service - find', () => {
  it('returns an empty array when no repos are registered', async () => {
    const result = await app.service('repos').find(params(regularUser));
    expect(result).toEqual([]);
  });

  it('returns registered repos with session_count and exists_on_fs', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/foo',
      bare_path: '/nonexistent/path',
      stripped_name: 'alice-foo',
    });
    await linkAliceToRepo(repoId);

    const result = await app.service('repos').find(params(regularUser));
    expect(result).toHaveLength(1);
    const repo = result[0];
    expect(repo.full_name).toBe('alice/foo');
    expect(repo.session_count).toBe(0);
    expect(repo.exists_on_fs).toBe(false);
  });

  it('counts only non-deleted sessions', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/foo',
      bare_path: '/nonexistent',
      stripped_name: 'alice-foo',
    });
    await linkAliceToRepo(repoId);
    await db('sessions').insert([
      {
        user_id: adminUser.id,
        repo_id: repoId,
        repo_full_name: 'alice/foo',
        base_branch: 'main',
        initial_prompt: 'p1',
        short_id: 'a1',
        status: 'stopped',
      },
      {
        user_id: adminUser.id,
        repo_id: repoId,
        repo_full_name: 'alice/foo',
        base_branch: 'main',
        initial_prompt: 'p2',
        short_id: 'a2',
        status: 'stopped',
      },
      {
        user_id: adminUser.id,
        repo_id: repoId,
        repo_full_name: 'alice/foo',
        base_branch: 'main',
        initial_prompt: 'p3',
        short_id: 'a3',
        status: 'stopped',
        archived_at: new Date().toISOString(),
      },
    ]);

    const result = await app.service('repos').find(params(regularUser));
    expect(Number(result[0].session_count)).toBe(2);
  });

  it('excludes soft-deleted repos', async () => {
    const [activeId] = await db('repos').insert({
      full_name: 'alice/active',
      bare_path: '/p1',
      stripped_name: 'alice-active',
    });
    await linkAliceToRepo(activeId);
    await db('repos').insert({
      full_name: 'alice/gone',
      bare_path: '/p2',
      stripped_name: 'alice-gone',
      deleted_at: new Date().toISOString(),
    });

    const result = await app.service('repos').find(params(regularUser));
    expect(result).toHaveLength(1);
    expect(result[0].full_name).toBe('alice/active');
  });

  it('orders repos by full_name', async () => {
    const [zorgId] = await db('repos').insert({
      full_name: 'zorg/repo',
      bare_path: '/p1',
      stripped_name: 'zorg-repo',
    });
    const [alphaId] = await db('repos').insert({
      full_name: 'alpha/repo',
      bare_path: '/p2',
      stripped_name: 'alpha-repo',
    });
    await linkAliceToRepo(zorgId);
    await linkAliceToRepo(alphaId);

    const result = await app.service('repos').find(params(regularUser));
    expect(result[0].full_name).toBe('alpha/repo');
    expect(result[1].full_name).toBe('zorg/repo');
  });

  it('unauthenticated find is rejected', async () => {
    await expect(app.service('repos').find(unauthParams)).rejects.toThrow('Not authenticated');
  });

  it('returns anthropic_api_key: null when not set on user_repos', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/nokey',
      stripped_name: 'alice-nokey',
      bare_path: '/nonexistent',
    });
    await linkAliceToRepo(repoId);
    const result = await app.service('repos').find(params(regularUser));
    const repo = result.find((r) => r.full_name === 'alice/nokey');
    expect(repo.anthropic_api_key).toBeNull();
    expect(repo.anthropic_api_key_encrypted).toBeUndefined();
  });

  it('returns masked anthropic_api_key for external callers when key is set', async () => {
    const { encrypt } = await import('../../lib/encrypt.js');
    const [repoId] = await db('repos').insert({
      full_name: 'alice/withkey',
      stripped_name: 'alice-withkey',
      bare_path: '/nonexistent',
    });
    await db('user_repos').insert({
      user_id: regularUser.id,
      repo_id: repoId,
      anthropic_api_key_encrypted: encrypt('sk-ant-secretkey123'),
    });
    const result = await app.service('repos').find(params(regularUser));
    const repo = result.find((r) => r.full_name === 'alice/withkey');
    expect(repo.anthropic_api_key).toBeTruthy();
    expect(repo.anthropic_api_key).not.toBe('sk-ant-secretkey123');
    expect(repo.anthropic_api_key_encrypted).toBeUndefined();
    expect(repo.user_repo_id).toBeTruthy();
  });

  it('returns plaintext anthropic_api_key for internal callers (no provider)', async () => {
    const { encrypt } = await import('../../lib/encrypt.js');
    const [repoId] = await db('repos').insert({
      full_name: 'alice/withkey2',
      stripped_name: 'alice-withkey2',
      bare_path: '/nonexistent',
    });
    await db('user_repos').insert({
      user_id: regularUser.id,
      repo_id: repoId,
      anthropic_api_key_encrypted: encrypt('sk-ant-plaintext456'),
    });
    const result = await app.service('repos').find({ user: regularUser }); // no provider
    const repo = result.find((r) => r.full_name === 'alice/withkey2');
    expect(repo.anthropic_api_key).toBe('sk-ant-plaintext456');
  });
});

// ---------------------------------------------------------------------------
// findRemote — GitHub API
// ---------------------------------------------------------------------------

describe('Repos service - findRemote', () => {
  it('filters user repos by query and returns { repos, hasMore }', async () => {
    listUserRepos.mockResolvedValue([
      { full_name: 'alice/foo', private: false },
      { full_name: 'alice/bar', private: true },
      { full_name: 'alice/other', private: false },
    ]);

    const result = await app.service('repos').findRemote({ query: 'foo' }, params(regularUser));

    expect(listUserRepos).toHaveBeenCalledWith('gh_token_user', scope());
    expect(result).toEqual({ repos: [{ full_name: 'alice/foo', private: false }], hasMore: false });
  });

  it('returns all repos when query is empty', async () => {
    listUserRepos.mockResolvedValue([
      { full_name: 'alice/foo', private: false },
      { full_name: 'alice/bar', private: true },
    ]);

    const result = await app.service('repos').findRemote({ query: '' }, params(regularUser));

    expect(result.repos).toHaveLength(2);
    expect(result.hasMore).toBe(false);
  });

  it('unauthenticated findRemote is rejected', async () => {
    await expect(app.service('repos').findRemote('foo', unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
    expect(listUserRepos).not.toHaveBeenCalled();
  });

  it('calls listOrgRepos when org is provided', async () => {
    listOrgRepos.mockResolvedValue([
      { full_name: 'myorg/alpha', private: false },
      { full_name: 'myorg/beta', private: true },
    ]);

    const result = await app.service('repos').findRemote({ org: 'myorg' }, params(regularUser));

    expect(listOrgRepos).toHaveBeenCalledWith('gh_token_user', scope(), 'myorg');
    expect(listUserRepos).not.toHaveBeenCalled();
    expect(result.repos).toHaveLength(2);
  });

  it('filters org repos by query', async () => {
    listOrgRepos.mockResolvedValue([
      { full_name: 'myorg/alpha', private: false },
      { full_name: 'myorg/beta', private: true },
    ]);

    const result = await app
      .service('repos')
      .findRemote({ org: 'myorg', query: 'alp' }, params(regularUser));

    expect(result.repos).toEqual([{ full_name: 'myorg/alpha', private: false }]);
  });
});

// ---------------------------------------------------------------------------
// findOrgs — GitHub API
// ---------------------------------------------------------------------------

describe('Repos service - findOrgs', () => {
  it('returns personal entry plus user orgs', async () => {
    listUserOrgs.mockResolvedValue([
      { login: 'myorg', avatar_url: 'https://example.com/avatar.png' },
    ]);

    const result = await app.service('repos').findOrgs({}, params(regularUser));

    expect(listUserOrgs).toHaveBeenCalledWith('gh_token_user', scope());
    expect(result[0]).toEqual({ login: 'personal', name: 'Personal' });
    expect(result[1]).toEqual({ login: 'myorg', avatar_url: 'https://example.com/avatar.png' });
    expect(result).toHaveLength(2);
  });

  it('returns only personal when user has no orgs', async () => {
    listUserOrgs.mockResolvedValue([]);

    const result = await app.service('repos').findOrgs({}, params(regularUser));

    expect(result).toEqual([{ login: 'personal', name: 'Personal' }]);
  });

  it('does not list other users as orgs (collaborator repos appear under Personal only)', async () => {
    listUserOrgs.mockResolvedValue([{ login: 'myorg' }]);

    const result = await app.service('repos').findOrgs({}, params(regularUser));

    expect(result.map((r) => r.login)).toEqual(['personal', 'myorg']);
  });

  it('unauthenticated findOrgs is rejected', async () => {
    await expect(app.service('repos').findOrgs({}, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
    expect(listUserOrgs).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GitHub App mode — repos come from installations, not from the whole account
// ---------------------------------------------------------------------------

describe('Repos service - GitHub App mode', () => {
  beforeEach(() => {
    configMock.authMode = 'app';
  });
  afterEach(() => {
    configMock.authMode = 'oauth';
  });

  it('findOrgs lists installation accounts instead of orgs', async () => {
    listUserInstallations.mockResolvedValue([
      { id: 42, login: 'alice', avatar_url: 'https://example.com/a.png', account_type: 'User' },
      {
        id: 43,
        login: 'myorg',
        avatar_url: 'https://example.com/o.png',
        account_type: 'Organization',
      },
    ]);

    const result = await app.service('repos').findOrgs({}, params(regularUser));

    expect(listUserInstallations).toHaveBeenCalledWith('gh_token_user', scope());
    expect(listUserOrgs).not.toHaveBeenCalled();
    expect(result).toEqual([
      { login: 'alice', name: 'alice', avatar_url: 'https://example.com/a.png' },
      { login: 'myorg', name: 'myorg', avatar_url: 'https://example.com/o.png' },
    ]);
  });

  it('findOrgs returns an empty list when the App is not installed anywhere', async () => {
    listUserInstallations.mockResolvedValue([]);

    expect(await app.service('repos').findOrgs({}, params(regularUser))).toEqual([]);
  });

  it('findRemote returns only the repos granted to that installation', async () => {
    listUserInstallations.mockResolvedValue([{ id: 42, login: 'myorg' }]);
    listInstallationRepos.mockResolvedValue([{ full_name: 'myorg/only-this-one', private: true }]);

    const result = await app.service('repos').findRemote({ org: 'myorg' }, params(regularUser));

    expect(listInstallationRepos).toHaveBeenCalledWith('gh_token_user', scope(), 42);
    expect(listUserRepos).not.toHaveBeenCalled();
    expect(listOrgRepos).not.toHaveBeenCalled();
    expect(result.repos).toEqual([{ full_name: 'myorg/only-this-one', private: true }]);
  });

  it('findRemote returns nothing for an account with no installation', async () => {
    listUserInstallations.mockResolvedValue([{ id: 42, login: 'myorg' }]);

    const result = await app.service('repos').findRemote({ org: 'other' }, params(regularUser));

    expect(listInstallationRepos).not.toHaveBeenCalled();
    expect(result).toEqual({ repos: [], hasMore: false });
  });

  it('findRemote still filters by query', async () => {
    listUserInstallations.mockResolvedValue([{ id: 42, login: 'myorg' }]);
    listInstallationRepos.mockResolvedValue([
      { full_name: 'myorg/alpha', private: false },
      { full_name: 'myorg/beta', private: false },
    ]);

    const result = await app
      .service('repos')
      .findRemote({ org: 'myorg', query: 'alp' }, params(regularUser));

    expect(result.repos).toEqual([{ full_name: 'myorg/alpha', private: false }]);
  });
});

// ---------------------------------------------------------------------------
// refresh — clear cache
// ---------------------------------------------------------------------------

describe('Repos service - refresh', () => {
  it('clears repos and branches cache for the token', async () => {
    const result = await app.service('repos').refresh({}, params(regularUser));

    expect(clearReposCache).toHaveBeenCalledWith(scope());
    expect(clearOrgsCache).toHaveBeenCalledWith(scope());
    expect(clearBranchesCache).toHaveBeenCalledWith(scope());
    expect(result).toEqual({ ok: true });
  });

  it('unauthenticated refresh is rejected', async () => {
    await expect(app.service('repos').refresh({}, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
    expect(clearReposCache).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// branches — GitHub API
// ---------------------------------------------------------------------------

describe('Repos service - branches', () => {
  it('returns branches for a given repo', async () => {
    const mockBranches = ['main', 'dev', 'feature/xyz'];
    listBranches.mockResolvedValue(mockBranches);

    const result = await app.service('repos').branches('alice/foo', params(regularUser));

    expect(listBranches).toHaveBeenCalledWith('gh_token_user', scope(), 'alice/foo');
    expect(result).toEqual({ branches: mockBranches });
  });

  it('unauthenticated branches call is rejected', async () => {
    await expect(app.service('repos').branches('alice/foo', unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
    expect(listBranches).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// create — register a repo via ensureBareClone
// ---------------------------------------------------------------------------

describe('Repos service - create', () => {
  it('admin creates a repo via ensureBareClone and returns the result', async () => {
    ensureBareClone.mockReturnValue('/repos/alice-new/main');

    const result = await app.service('repos').create({ fullName: 'alice/new' }, params(adminUser));

    expect(ensureBareClone).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'alice/new', stripped_name: 'alice-new' }),
      'gh_token_admin'
    );
    expect(result.repo.full_name).toBe('alice/new');
    expect(result.repo.stripped_name).toBe('alice-new');
    expect(result.hasBaguetteConfig).toBe(false);
  });

  it('revives a soft-deleted repo when recreating with the same full_name', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/myrepo',
      bare_path: '/nonexistent',
      stripped_name: 'alice-myrepo',
      deleted_at: new Date().toISOString(),
    });

    ensureBareClone.mockReturnValue('/repos/alice-myrepo/main');

    await app.service('repos').create({ fullName: 'alice/myrepo' }, params(adminUser));

    const repo = await db('repos').where({ id: repoId }).first();
    expect(repo.deleted_at).toBeNull();
  });

  it('any authenticated user can create a repo', async () => {
    ensureBareClone.mockReturnValue('/repos/alice-new/main');
    const result = await app
      .service('repos')
      .create({ fullName: 'alice/new' }, params(regularUser));
    expect(ensureBareClone).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'alice/new' }),
      'gh_token_user'
    );
    expect(result.repo.full_name).toBe('alice/new');
  });

  it('unauthenticated create is rejected', async () => {
    await expect(
      app.service('repos').create({ fullName: 'alice/new' }, unauthParams)
    ).rejects.toThrow('Not authenticated');
    expect(ensureBareClone).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// remove — soft-delete repo and its sessions
// ---------------------------------------------------------------------------

describe('Repos service - remove', () => {
  it('admin soft-deletes a repo with no sessions', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/old',
      bare_path: '/nonexistent',
      stripped_name: 'alice-old',
    });

    const result = await app.service('repos').remove(repoId, params(adminUser));

    expect(result).toEqual({ ok: true });
    const row = await db('repos').where({ id: repoId }).first();
    expect(row).toBeTruthy();
    expect(row.deleted_at).toBeTruthy();
  });

  it('delegates session cleanup to sessions service before soft-deleting the repo', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/old',
      bare_path: '/nonexistent',
      stripped_name: 'alice-old',
    });

    await app.service('repos').remove(repoId, params(adminUser));

    expect(removeByRepoId).toHaveBeenCalledWith(repoId, expect.anything());

    const repo = await db('repos').where({ id: repoId }).first();
    expect(repo.deleted_at).toBeTruthy();
  });

  it('throws NotFound for an unknown repo id', async () => {
    await expect(app.service('repos').remove(99999, params(adminUser))).rejects.toBeInstanceOf(
      NotFound
    );
  });

  it('any authenticated user can remove a repo', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/old',
      bare_path: '/nonexistent',
      stripped_name: 'alice-old',
    });
    const result = await app.service('repos').remove(repoId, params(regularUser));
    expect(result).toEqual({ ok: true });
    const row = await db('repos').where({ id: repoId }).first();
    expect(row.deleted_at).toBeTruthy();
  });

  it('unauthenticated remove is rejected', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/old',
      bare_path: '/nonexistent',
      stripped_name: 'alice-old',
    });
    await expect(app.service('repos').remove(repoId, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

// ---------------------------------------------------------------------------
// Soft-delete cycle tests
// ---------------------------------------------------------------------------

describe('Repos service - soft-delete lifecycle', () => {
  it('delegates session cleanup to sessions service and soft-deletes the repo', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/proj',
      bare_path: '/nonexistent',
      stripped_name: 'alice-proj',
    });

    await app.service('repos').remove(repoId, params(adminUser));

    expect(removeByRepoId).toHaveBeenCalledWith(repoId, expect.anything());

    const repo = await db('repos').where({ id: repoId }).first();
    expect(repo).toBeTruthy();
    expect(repo.deleted_at).toBeTruthy();
  });

  it('reviving a soft-deleted repo does not touch sessions', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/revival',
      bare_path: '/nonexistent',
      stripped_name: 'alice-revival',
    });

    await app.service('repos').remove(repoId, params(adminUser));
    expect(removeByRepoId).toHaveBeenCalledTimes(1);

    // Revive by recreating with same full_name
    ensureBareClone.mockReturnValue('/repos/alice-revival/main');
    await app.service('repos').create({ fullName: 'alice/revival' }, params(adminUser));

    // Repo is revived, removeByRepoId not called again
    const repo = await db('repos').where({ id: repoId }).first();
    expect(repo.deleted_at).toBeNull();
    expect(removeByRepoId).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// configure — generate onboarding prompt
// ---------------------------------------------------------------------------

describe('Repos service - get', () => {
  it('any authenticated user can get a repo by id', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/project',
      bare_path: '/nonexistent',
      stripped_name: 'alice-project',
    });

    const result = await app.service('repos').get(repoId, params(regularUser));
    expect(result.id).toBe(repoId);
    expect(result.full_name).toBe('alice/project');
  });

  it('returns 404 for an unknown repo id', async () => {
    await expect(app.service('repos').get(99999, params(regularUser))).rejects.toBeInstanceOf(
      NotFound
    );
  });

  it('unauthenticated get is rejected', async () => {
    await expect(app.service('repos').get(1, unauthParams)).rejects.toThrow('Not authenticated');
  });
});

describe('Repos service - patch', () => {
  it('any authenticated user can patch a repo', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/project',
      bare_path: '/nonexistent',
      stripped_name: 'alice-project',
    });

    const result = await app
      .service('repos')
      .patch(repoId, { bare_path: '/updated' }, params(regularUser));
    expect(result.bare_path).toBe('/updated');
  });

  it('unauthenticated patch is rejected', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/project',
      bare_path: '/nonexistent',
      stripped_name: 'alice-project',
    });
    await expect(
      app.service('repos').patch(repoId, { bare_path: '/updated' }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });
});

describe('Repos service - configure', () => {
  it('admin generates an onboarding prompt for a registered repo', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/project',
      bare_path: '/nonexistent',
      stripped_name: 'alice-project',
    });

    const result = await app.service('repos').configure(repoId, params(adminUser));

    expect(result.prompt).toMatch('Check if `.baguette.yaml` already exists');
  });

  it('throws NotFound for an unknown repo id', async () => {
    await expect(app.service('repos').configure(99999, params(adminUser))).rejects.toBeInstanceOf(
      NotFound
    );
  });

  it('any authenticated user can configure a repo', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/project',
      bare_path: '/nonexistent',
      stripped_name: 'alice-project',
    });

    const result = await app.service('repos').configure(repoId, params(regularUser));
    expect(result.prompt).toMatch('Check if `.baguette.yaml` already exists');
  });

  it('unauthenticated configure is rejected', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/project',
      bare_path: '/nonexistent',
      stripped_name: 'alice-project',
    });
    await expect(app.service('repos').configure(repoId, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});
