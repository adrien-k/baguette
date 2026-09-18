import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { KnexService } from '@feathersjs/knex';

const execFileAsync = promisify(execFile);
import { NotFound } from '@feathersjs/errors';
import {
  listUserRepos,
  listUserOrgs,
  listOrgRepos,
  clearReposCache,
  clearOrgsCache,
  clearBranchesCache,
  listBranches,
  ensureBareClone,
  initLocalRepo,
  ensureLocalClone,
  toStrippedName,
} from '../github.js';
import { loadBaguetteConfig } from '../baguette-config.js';
import loadPrompt from '../../prompts/loadPrompt.js';
import { requireUser, decryptFields } from './hooks.js';
import { getEffectiveGithubToken } from '../agent-settings.js';
import { REPOS_DIR, DOCKER_COMPOSE_PATH } from '../../config.js';

/** True for local repos: absolute path (imported) or plain name with no "/" (brand-new). */
const isLocalRepo = (fullName) => fullName.startsWith('/') || !fullName.includes('/');

class ReposService extends KnexService {
  setup(app) {
    this.app = app;
  }

  /**
   * Returns repos linked to the current user via user_repos, with session_count and exists_on_fs.
   * Plain array (no pagination) — repos list is small.
   */
  async find(params) {
    const db = this.options.Model;
    const repos = await db('repos')
      .join('user_repos', 'repos.id', 'user_repos.repo_id')
      .where('user_repos.user_id', params.user.id)
      .select(
        'repos.id',
        'repos.full_name',
        'repos.stripped_name',
        'repos.bare_path',
        'repos.default_branch',
        'repos.created_at',
        'user_repos.id as user_repo_id',
        'user_repos.anthropic_api_key_encrypted'
      )
      .whereNull('repos.deleted_at')
      .orderBy('repos.full_name');

    if (repos.length === 0) return [];

    const counts = await db('sessions')
      .whereIn(
        'repo_id',
        repos.map((r) => r.id)
      )
      .whereNull('archived_at')
      .groupBy('repo_id')
      .select('repo_id')
      .count('* as cnt');
    const countMap = Object.fromEntries(counts.map((c) => [c.repo_id, Number(c.cnt)]));

    const existsOnFs = await Promise.all(
      repos.map((r) =>
        r.bare_path
          ? fs.promises
              .access(r.bare_path)
              .then(() => true)
              .catch(() => false)
          : Promise.resolve(false)
      )
    );
    return repos.map((r, i) => ({
      ...r,
      session_count: countMap[r.id] ?? 0,
      exists_on_fs: existsOnFs[i],
    }));
  }

  /**
   * Returns all registered repos (admin view) with session_count and exists_on_fs.
   */
  async findAll(_data, _params) {
    const db = this.options.Model;
    const repos = await db('repos')
      .select(
        'repos.id',
        'repos.full_name',
        'repos.stripped_name',
        'repos.bare_path',
        'repos.default_branch',
        'repos.created_at'
      )
      .whereNull('repos.deleted_at')
      .orderBy('repos.full_name');

    if (repos.length === 0) return [];

    const counts = await db('sessions')
      .whereIn(
        'repo_id',
        repos.map((r) => r.id)
      )
      .whereNull('archived_at')
      .groupBy('repo_id')
      .select('repo_id')
      .count('* as cnt');
    const countMap = Object.fromEntries(counts.map((c) => [c.repo_id, Number(c.cnt)]));

    const existsOnFs = await Promise.all(
      repos.map((r) =>
        r.bare_path
          ? fs.promises
              .access(r.bare_path)
              .then(() => true)
              .catch(() => false)
          : Promise.resolve(false)
      )
    );
    return repos.map((r, i) => ({
      ...r,
      session_count: countMap[r.id] ?? 0,
      exists_on_fs: existsOnFs[i],
    }));
  }

  /**
   * Clone (or re-fetch) a repo bare clone from GitHub and register it in the DB.
   * Also checks for baguette/host config in the repo.
   */
  async create(data, params) {
    const { fullName } = data;
    const db = this.options.Model;
    let repo = await db('repos').where({ full_name: fullName }).first();

    let strippedName = repo?.stripped_name;
    if (!strippedName) {
      const base = toStrippedName(fullName);
      const taken = await db('repos').where({ stripped_name: base }).first();
      if (taken) {
        let n = 0;
        while (
          await db('repos')
            .where({ stripped_name: `${base}-${n}` })
            .first()
        )
          n++;
        strippedName = `${base}-${n}`;
      } else {
        strippedName = base;
      }
    }

    const barePath = await ensureBareClone(
      { full_name: fullName, stripped_name: strippedName, bare_path: repo?.bare_path },
      getEffectiveGithubToken(params.user)
    );

    let defaultBranch;
    try {
      const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: barePath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      defaultBranch = stdout.trim() || 'main';
    } catch {
      defaultBranch = 'main';
    }

    const now = new Date().toISOString();
    if (repo) {
      const updates = {
        bare_path: barePath,
        stripped_name: strippedName,
        default_branch: defaultBranch,
        last_fetched_at: now,
      };
      if (repo.deleted_at) updates.deleted_at = null;
      await db('repos').where({ id: repo.id }).update(updates);
      repo = { ...repo, ...updates };
    } else {
      [repo] = await db('repos')
        .insert({
          full_name: fullName,
          stripped_name: strippedName,
          bare_path: barePath,
          default_branch: defaultBranch,
          last_fetched_at: now,
        })
        .returning('*');
    }

    let hasBaguetteConfig = false;

    const tmpId = `_check_${Date.now()}`;
    const tmpWorktree = path.join(REPOS_DIR, repo.stripped_name, 'sessions', tmpId);
    try {
      await fs.promises.mkdir(path.dirname(tmpWorktree), { recursive: true });
      await execFileAsync('git', ['worktree', 'add', '--detach', tmpWorktree, defaultBranch], {
        cwd: repo.bare_path,
        stdio: 'pipe',
      });

      const config = await loadBaguetteConfig(tmpWorktree);
      if (config) {
        hasBaguetteConfig = true;
      }

      await execFileAsync('git', ['worktree', 'remove', '--force', tmpWorktree], {
        cwd: repo.bare_path,
        stdio: 'pipe',
      });
    } catch {
      await fs.promises.rm(tmpWorktree, { recursive: true, force: true }).catch(() => {});
    }

    // Link repo to the current user (ignore if already linked)
    await db('user_repos')
      .insert({ user_id: params.user.id, repo_id: repo.id })
      .onConflict(['user_id', 'repo_id'])
      .ignore();

    return { repo, hasBaguetteConfig };
  }

  /**
   * Admin full cleanup: kill sessions, remove FS, delete all user_repos entries, soft-delete repo.
   */
  async remove(id, params) {
    const db = this.app.get('db');
    const repo = await db('repos').where({ id }).first();
    if (!repo) throw new NotFound('Repository not found');
    await this.app.service('sessions').removeByRepoId(id, { user: params?.user });

    if (repo.stripped_name) {
      const repoDir = path.join(REPOS_DIR, repo.stripped_name);
      await fs.promises.rm(repoDir, { recursive: true, force: true }).catch(() => {});
    }

    await db('user_repos').where({ repo_id: id }).delete();
    await db('repos').where({ id }).update({ deleted_at: new Date().toISOString() });
    return { ok: true };
  }

  /**
   * Unlink the current user's allocation. If no other users reference this repo, performs full cleanup.
   */
  async unlink(id, params) {
    const db = this.app.get('db');
    const repo = await db('repos').where({ id }).whereNull('deleted_at').first();
    if (!repo) throw new NotFound('Repository not found');

    await db('user_repos').where({ user_id: params.user.id, repo_id: id }).delete();

    const remaining = await db('user_repos').where({ repo_id: id }).count('* as cnt').first();
    if (Number(remaining.cnt) === 0) {
      await this.app.service('sessions').removeByRepoId(id, { user: params?.user });
      if (repo.stripped_name) {
        const repoDir = path.join(REPOS_DIR, repo.stripped_name);
        await fs.promises.rm(repoDir, { recursive: true, force: true }).catch(() => {});
      }
      await db('repos').where({ id }).update({ deleted_at: new Date().toISOString() });
    }

    return { ok: true };
  }

  async findOrgs(data, params) {
    const token = getEffectiveGithubToken(params.user);
    const orgs = await listUserOrgs(token);
    return [{ login: 'personal', name: 'Personal' }, ...orgs];
  }

  /** List and filter GitHub repos for the authenticated user or an org. Returns { repos, hasMore }. */
  async findRemote(data, params) {
    const { org = 'personal', query = '' } =
      typeof data === 'string' ? { query: data } : data || {};
    const token = getEffectiveGithubToken(params.user);
    let allRepos;
    if (org === 'personal') {
      allRepos = await listUserRepos(token);
    } else {
      allRepos = await listOrgRepos(token, org);
    }
    const q = query.trim().toLowerCase();
    const filtered = q ? allRepos.filter((r) => r.full_name.toLowerCase().includes(q)) : allRepos;
    return { repos: filtered.slice(0, 20), hasMore: filtered.length > 20 };
  }

  async refresh(data, params) {
    const token = getEffectiveGithubToken(params.user);
    clearReposCache(token);
    clearOrgsCache(token);
    clearBranchesCache(token);
    return { ok: true };
  }

  /** Fetch branches for a repo. Uses GitHub API for GitHub repos; reads local git refs for local repos. */
  async branches(data, params) {
    const fullName = data;
    if (isLocalRepo(fullName)) {
      const db = this.options.Model;
      const repo = await db('repos').where({ full_name: fullName }).whereNull('deleted_at').first();
      if (repo?.bare_path) {
        const { stdout } = await execFileAsync(
          'git',
          ['branch', '--list', '--format=%(refname:short)'],
          {
            cwd: repo.bare_path,
            stdio: 'pipe',
          }
        );
        return { branches: stdout.split('\n').filter(Boolean) };
      }
      return { branches: [] };
    }
    const branches = await listBranches(getEffectiveGithubToken(params.user), fullName);
    return { branches };
  }

  /**
   * Create a brand-new local repo (by name) or import an existing local git directory (by path).
   * No GitHub required.
   *
   * - { name }      → git init a fresh repo; full_name = name (no "/" allowed)
   * - { localPath } → git clone from that directory; full_name = absolute localPath
   */
  async createLocal(data, params) {
    const { name, localPath } = data;
    if (!name && !localPath)
      throw new Error('Provide either name (new repo) or localPath (import)');

    const fullName = localPath ?? name;
    if (!localPath && name.includes('/')) throw new Error('Repo name must not contain "/"');

    const db = this.options.Model;
    let repo = await db('repos').where({ full_name: fullName }).first();

    let strippedName = repo?.stripped_name;
    if (!strippedName) {
      // For imported repos derive from the basename; for new repos use the name itself
      const base = toStrippedName(localPath ? path.basename(localPath) : name);
      const taken = await db('repos').where({ stripped_name: base }).first();
      if (taken) {
        let n = 0;
        while (
          await db('repos')
            .where({ stripped_name: `${base}-${n}` })
            .first()
        )
          n++;
        strippedName = `${base}-${n}`;
      } else {
        strippedName = base;
      }
    }

    const repoPath = localPath
      ? await ensureLocalClone(localPath, strippedName)
      : await initLocalRepo(strippedName);

    let defaultBranch;
    try {
      const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      defaultBranch = stdout.trim() || 'main';
    } catch {
      defaultBranch = 'main';
    }

    const now = new Date().toISOString();
    if (repo) {
      const updates = {
        bare_path: repoPath,
        stripped_name: strippedName,
        default_branch: defaultBranch,
        last_fetched_at: now,
      };
      if (repo.deleted_at) updates.deleted_at = null;
      await db('repos').where({ id: repo.id }).update(updates);
      repo = { ...repo, ...updates };
    } else {
      [repo] = await db('repos')
        .insert({
          full_name: fullName,
          stripped_name: strippedName,
          bare_path: repoPath,
          default_branch: defaultBranch,
          last_fetched_at: now,
        })
        .returning('*');
    }

    let hasBaguetteConfig = false;
    const tmpId = `_check_${Date.now()}`;
    const tmpWorktree = path.join(REPOS_DIR, repo.stripped_name, 'sessions', tmpId);
    try {
      await fs.promises.mkdir(path.dirname(tmpWorktree), { recursive: true });
      await execFileAsync('git', ['worktree', 'add', '--detach', tmpWorktree, defaultBranch], {
        cwd: repo.bare_path,
        stdio: 'pipe',
      });
      const config = await loadBaguetteConfig(tmpWorktree);
      if (config) hasBaguetteConfig = true;
      await execFileAsync('git', ['worktree', 'remove', '--force', tmpWorktree], {
        cwd: repo.bare_path,
        stdio: 'pipe',
      });
    } catch {
      await fs.promises.rm(tmpWorktree, { recursive: true, force: true }).catch(() => {});
    }

    await db('user_repos')
      .insert({ user_id: params.user.id, repo_id: repo.id })
      .onConflict(['user_id', 'repo_id'])
      .ignore();

    return { repo, hasBaguetteConfig };
  }

  /** Generate an onboarding prompt for a registered repo. */
  async configure(data, _params) {
    const db = this.options.Model;
    const repo = await db('repos').where({ id: data }).first();
    if (!repo) throw new NotFound('Repository not found');
    const prompt = await loadPrompt('onboarding-prompt', {
      DOCKER_COMPOSE_PATH: DOCKER_COMPOSE_PATH,
    });
    return { prompt, repoFullName: repo.full_name };
  }
}

export const reposHooks = {
  before: {
    all: [requireUser],
  },
  after: {
    find: [decryptFields({ anthropic_api_key: 'anthropic_api_key_encrypted' })],
  },
};

export function registerReposService(app, path = 'repos') {
  const options = {
    Model: app.get('db'),
    name: 'repos',
    id: 'id',
    paginate: false,
  };
  app.use(path, new ReposService(options), {
    methods: [
      'find',
      'get',
      'create',
      'remove',
      'findRemote',
      'findOrgs',
      'branches',
      'configure',
      'refresh',
      'findAll',
      'unlink',
      'createLocal',
    ],
  });
  app.service(path).hooks(reposHooks);
}
