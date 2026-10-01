import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { REPOS_DIR, resolveDataDirRelativePath } from '../config.js';
import * as cache from '../lib/cache.js';
import {
  buildLogRangeHeader,
  MAX_LOG_RANGE_BYTES,
  rangeNeedsFullLogFetch,
  sliceByteRange,
  validateLogByteRange,
} from './mcp-pagination.js';
import { githubFetch } from './github-api.js';

export { configureWorktreeGitIdentity } from './git-identity.js';

const execFileAsync = promisify(execFile);

export function gitAuthArgs(token) {
  const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.https://github.com/.extraheader=Authorization: Basic ${encoded}`];
}

export function sanitizeGitError(token, err) {
  const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
  const sanitize = (s) =>
    typeof s === 'string' ? s.replaceAll(encoded, '[REDACTED]').replaceAll(token, '[REDACTED]') : s;
  err.message = sanitize(err.message);
  if (err.stderr) err.stderr = sanitize(err.stderr.toString());
  if (err.stdout) err.stdout = sanitize(err.stdout.toString());
  return err;
}

async function gitWithToken(token, args, opts) {
  if (!token) {
    return execFileAsync('git', args, opts);
  }
  try {
    return await execFileAsync('git', [...gitAuthArgs(token), ...args], opts);
  } catch (err) {
    throw sanitizeGitError(token, err);
  }
}

let _lfsAvailable = null;
async function lfsAvailable() {
  if (_lfsAvailable === null) {
    try {
      await execFileAsync('git', ['lfs', 'version'], { stdio: 'pipe' });
      _lfsAvailable = true;
    } catch {
      _lfsAvailable = false;
    }
  }
  return _lfsAvailable;
}

function repoUrl(repoFullName) {
  return `https://github.com/${repoFullName}.git`;
}

/** Alphanumeric and dashes only, for directory names. Stored on repo record. */
export function toStrippedName(fullName) {
  return (
    fullName
      .replace(/\//g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'repo'
  );
}

/** Base directory for all repo data (worktrees, bare clone): `<REPOS_DIR>/<stripped>/` */
export function repoDirPath(strippedName) {
  return path.join(REPOS_DIR, strippedName);
}

function barePathForStripped(strippedName) {
  return path.join(repoDirPath(strippedName), 'main');
}

/**
 * Cache scope for a user's GitHub lists. Keyed by user id rather than by the token value so
 * cached lists survive a token being rotated or re-issued.
 */
export function cacheScopeForUser(user) {
  return user?.id ? `u${user.id}` : 'anonymous';
}

function repoHash(repoFullName) {
  return crypto.createHash('sha256').update(repoFullName).digest('hex');
}

/**
 * Generic paginated GitHub API fetch.
 * @param {string} url    Base URL (without page param)
 * @param {string} token  GitHub token
 * @param {(item: object) => T} mapFn  Transform each response item
 * @param {{ itemsKey?: string }} [opts]  itemsKey unwraps envelope responses such as
 *   `/user/installations` ({ total_count, installations: [...] }), which return an object
 *   rather than a bare array.
 * @returns {Promise<T[]>}
 */
async function fetchAllPages(url, token, mapFn, { itemsKey } = {}) {
  const results = [];
  const separator = url.includes('?') ? '&' : '?';
  let page = 1;
  while (true) {
    const res = await githubFetch(`${url}${separator}per_page=100&page=${page}`, { token });
    if (!res.ok) break;
    const body = await res.json();
    const data = itemsKey ? body?.[itemsKey] : body;
    if (!Array.isArray(data) || data.length === 0) break;
    for (const item of data) results.push(mapFn(item));
    if (data.length < 100) break;
    page++;
  }
  return results;
}

const mapRepo = (r) => ({
  full_name: r.full_name,
  description: r.description,
  private: r.private,
  default_branch: r.default_branch,
});

// Refreshing installation and repo lists is manual, so we can cache them indefinitely
const REPOS_CACHE_TTL = Infinity;

/**
 * GitHub App installations the signed-in user can see, one per account (personal or org) the App
 * is installed on.
 */
export function listUserInstallations(token, scope) {
  return cache.fetch(`github-installations-${scope}`, REPOS_CACHE_TTL, () =>
    fetchAllPages(
      'https://api.github.com/user/installations',
      token,
      (i) => ({
        id: i.id,
        login: i.account?.login,
        avatar_url: i.account?.avatar_url,
        account_type: i.account?.type,
      }),
      { itemsKey: 'installations' }
    )
  );
}

/**
 * Repos the user selected when installing the App on a given account. This is what makes
 * single-repo access work: GitHub only returns the repos granted to that installation.
 */
export function listInstallationRepos(token, scope, installationId) {
  return cache.fetch(`github-repos-${scope}-installation-${installationId}`, REPOS_CACHE_TTL, () =>
    fetchAllPages(
      `https://api.github.com/user/installations/${installationId}/repositories`,
      token,
      mapRepo,
      { itemsKey: 'repositories' }
    )
  );
}

/** Repos visible to a personal access token (Settings → GitHub token override). */
export function listUserReposForPicker(token, scope) {
  return cache.fetch(`github-user-repos-${scope}`, REPOS_CACHE_TTL, () =>
    fetchAllPages(
      'https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=updated',
      token,
      mapRepo
    )
  );
}

export function orgLoginsFromRepos(repos) {
  const logins = new Set();
  for (const r of repos) {
    const login = r.full_name?.split('/')[0];
    if (login) logins.add(login);
  }
  return [...logins].sort((a, b) => a.localeCompare(b));
}

const BRANCHES_CACHE_TTL = 60;
export function listBranches(token, scope, repoFullName) {
  return cache.fetch(`github-branches-${scope}-${repoHash(repoFullName)}`, BRANCHES_CACHE_TTL, () =>
    fetchAllPages(`https://api.github.com/repos/${repoFullName}/branches`, token, (b) => b.name)
  );
}

export function clearReposCache(scope) {
  return cache.clearByPrefix(`github-repos-${scope}-`);
}

export function clearUserReposPickerCache(scope) {
  return cache.clearByPrefix(`github-user-repos-${scope}`);
}

export function clearInstallationsCache(scope) {
  return cache.clearByPrefix(`github-installations-${scope}`);
}

export function clearBranchesCache(scope) {
  return cache.clearByPrefix(`github-branches-${scope}-`);
}

/**
 * Ensures a bare clone of the repo exists on disk. If already cloned, returns
 * the barePath immediately. Otherwise clones from GitHub. Returns the barePath.
 *
 * @param {object} repo - { full_name, stripped_name, bare_path? }
 * @param {string} token
 */
export async function ensureBareClone(repo, token) {
  const barePath = repo.bare_path || barePathForStripped(repo.stripped_name);

  try {
    await fs.promises.access(barePath);
    return barePath;
  } catch {
    /* clone not present yet */
  }

  await fs.promises.mkdir(path.dirname(barePath), { recursive: true });
  try {
    await fs.promises.rm(barePath, { recursive: true, force: true });
  } catch {
    /* path may not exist */
  }
  await gitWithToken(token, ['clone', repoUrl(repo.full_name), barePath], {
    stdio: 'pipe',
  });
  if (await lfsAvailable()) {
    try {
      await gitWithToken(token, ['lfs', 'fetch', '--all'], { cwd: barePath, stdio: 'pipe' });
    } catch {
      /* repo may not use LFS */
    }
  }
  return barePath;
}

/**
 * Initialize a brand-new local git repo with an empty initial commit.
 * Returns the repo path (same convention as bare_path).
 */
export async function initLocalRepo(strippedName) {
  const repoPath = barePathForStripped(strippedName);
  await fs.promises.mkdir(repoPath, { recursive: true });
  await execFileAsync('git', ['init', repoPath], { stdio: 'pipe' });
  await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'Initial commit'], {
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Baguette',
      GIT_AUTHOR_EMAIL: 'baguette@localhost',
      GIT_COMMITTER_NAME: 'Baguette',
      GIT_COMMITTER_EMAIL: 'baguette@localhost',
    },
  });
  return repoPath;
}

/**
 * Clone an existing local git repo (non-bare) into REPOS_DIR for use as a session source.
 * Returns the repo path.
 */
export async function ensureLocalClone(localPath, strippedName) {
  const repoPath = barePathForStripped(strippedName);
  try {
    await fs.promises.access(repoPath);
    return repoPath;
  } catch {
    /* not cloned yet */
  }
  await fs.promises.mkdir(path.dirname(repoPath), { recursive: true });
  await execFileAsync('git', ['clone', localPath, repoPath], { stdio: 'pipe' });
  return repoPath;
}

/**
 * Local branch name unique to this worktree so Git will allow another session
 * to keep `intendedBranch` checked out (or share the same remote head).
 */
export function uniqueLocalBranch(intendedBranch, shortId) {
  if (!intendedBranch) return intendedBranch;
  if (!shortId) return intendedBranch;
  const suffix = `-${shortId}`;
  if (intendedBranch.endsWith(suffix)) return intendedBranch;
  return `${intendedBranch}${suffix}`;
}

/** True when `git fetch origin <branch>` failed because the ref is not on the remote (local may still exist). */
export function isMissingRemoteRefError(err) {
  const msg = err?.stderr?.toString() ?? err?.message ?? '';
  return (
    msg.includes('No such remote') ||
    msg.includes('does not appear to be a git repository') ||
    msg.includes("couldn't find remote ref") ||
    msg.includes('could not find remote ref')
  );
}

export async function trySetBranchUpstream(worktreePath, localBranch, remoteBranch) {
  if (!worktreePath || !localBranch || !remoteBranch) return;
  try {
    await execFileAsync(
      'git',
      ['branch', '--set-upstream-to', `origin/${remoteBranch}`, localBranch],
      { cwd: worktreePath, stdio: 'pipe' }
    );
  } catch {
    /* origin/<remoteBranch> may not exist yet */
  }
}

/** True when `worktreePath` is already a linked git worktree (not merely an existing directory). */
async function isLinkedWorktree(worktreePath) {
  try {
    const dotGit = await fs.promises.readFile(path.join(worktreePath, '.git'), 'utf8');
    if (!dotGit.trimStart().startsWith('gitdir:')) return false;
    const gitdir = dotGit.trim().slice('gitdir:'.length).trim();
    await fs.promises.access(gitdir);
    return true;
  } catch {
    return false;
  }
}

/** @param {{ baseBranch?: string, detach?: boolean, localBranch?: string }} [opts] — `detach` defaults to true (false checks out `branch` in the new worktree). `localBranch` creates a unique local ref instead of checking out `branch`. */
export async function createWorktree(repo, branch, worktreeId, token, opts = {}) {
  const { baseBranch, detach = true, localBranch = null } = opts;
  const barePath = repo.bare_path;
  const worktreePath = path.join(REPOS_DIR, repo.stripped_name, 'sessions', worktreeId, 'worktree');
  await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });

  // Fetch into a session-unique temp ref to:
  // 1. Avoid "refusing to fetch into branch checked out at ..." — the temp ref is never
  //    checked out in any worktree so git never blocks the fetch.
  // 2. Capture the exact remote SHA so we can update the (potentially stale) local branch ref.
  const tempRef = `refs/baguette-fetch/${worktreeId}`;
  try {
    await gitWithToken(token, ['fetch', 'origin', `+${branch}:${tempRef}`], {
      cwd: barePath,
      stdio: 'pipe',
    });
  } catch (err) {
    if (!isMissingRemoteRefError(err)) throw err;
    // No origin or branch never pushed — use existing local branch ref as-is
  }
  // Sync the local branch ref to the fetched commit so new worktrees start from the latest
  // remote commit rather than the stale commit from when the bare clone was created.
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', tempRef], {
      cwd: barePath,
      stdio: 'pipe',
    });
    await execFileAsync('git', ['update-ref', `refs/heads/${branch}`, stdout.trim()], {
      cwd: barePath,
      stdio: 'pipe',
    });
  } catch {
    /* fall back to existing local ref */
  }
  // Clean up temp ref (best-effort)
  try {
    await execFileAsync('git', ['update-ref', '-d', tempRef], { cwd: barePath, stdio: 'pipe' });
  } catch {
    /* ignore */
  }

  // Also fetch the base branch so origin/<baseBranch> is up to date for merge-base diffs
  if (baseBranch && baseBranch !== branch) {
    try {
      await gitWithToken(
        token,
        ['fetch', 'origin', `+${baseBranch}:refs/remotes/origin/${baseBranch}`],
        { cwd: barePath, stdio: 'pipe' }
      );
    } catch {
      /* local repo with no remote — skip */
    }
  }

  if (await lfsAvailable()) {
    try {
      await gitWithToken(token, ['lfs', 'fetch', 'origin', branch], {
        cwd: barePath,
        stdio: 'pipe',
      });
    } catch {
      /* repo may not use LFS */
    }
  }

  if (!(await isLinkedWorktree(worktreePath))) {
    try {
      await fs.promises.rm(worktreePath, { recursive: true, force: true });
    } catch {
      /* path may not exist yet */
    }
    const addArgs = localBranch
      ? ['worktree', 'add', '-B', localBranch, worktreePath, branch]
      : detach
        ? ['worktree', 'add', '--detach', worktreePath, branch]
        : ['worktree', 'add', worktreePath, branch];
    await execFileAsync('git', addArgs, {
      cwd: barePath,
      stdio: 'pipe',
    });
  }

  if (localBranch) {
    await trySetBranchUpstream(worktreePath, localBranch, branch);
  }

  if (await lfsAvailable()) {
    try {
      await execFileAsync('git', ['lfs', 'checkout'], { cwd: worktreePath, stdio: 'pipe' });
    } catch {
      /* ignore */
    }
  }

  return { worktreePath };
}

/** Resolve the on-disk worktree path from the DB row, or from repo + short_id when still provisioning. */
export function resolveSessionWorktreePath(session, repo) {
  const fromDb = resolveDataDirRelativePath(session?.worktree_path);
  if (fromDb) return fromDb;
  const stripped = repo?.stripped_name || (repo?.full_name ? toStrippedName(repo.full_name) : null);
  if (session?.short_id && stripped) {
    return path.join(REPOS_DIR, stripped, 'sessions', session.short_id, 'worktree');
  }
  return null;
}

export async function tryDeleteUniqueLocalBranch(barePath, session) {
  const localBranch = session?.local_branch;
  const remoteBranch = session?.remote_branch;
  if (!barePath || !localBranch || !remoteBranch || localBranch === remoteBranch) return;
  try {
    await execFileAsync('git', ['branch', '-D', localBranch], {
      cwd: barePath,
      stdio: 'pipe',
    });
  } catch {
    /* missing ref or still checked out — archive must not fail */
  }
}

export async function removeWorktree(session, repo) {
  // Global sessions use the shared REPOS_DIR as cwd — never delete it.
  if (session?.is_global) return;
  const absoluteWorktreePath = resolveSessionWorktreePath(session, repo);
  const deleteUnique = () => tryDeleteUniqueLocalBranch(repo?.bare_path, session);
  if (!absoluteWorktreePath) {
    await deleteUnique();
    return;
  }
  if (path.resolve(absoluteWorktreePath) === path.resolve(REPOS_DIR)) return;
  try {
    await fs.promises.access(absoluteWorktreePath);
  } catch {
    await deleteUnique();
    return;
  }

  // New structure: worktree lives at .../sessions/<id>/worktree — clean the whole session dir.
  const isNewStructure = path.basename(absoluteWorktreePath) === 'worktree';
  const cleanupPath = isNewStructure ? path.dirname(absoluteWorktreePath) : absoluteWorktreePath;

  if (repo?.bare_path) {
    try {
      await fs.promises.access(repo.bare_path);
      await execFileAsync('git', ['worktree', 'remove', '--force', absoluteWorktreePath], {
        cwd: repo.bare_path,
        stdio: 'pipe',
      });
      if (isNewStructure) {
        await fs.promises.rm(cleanupPath, { recursive: true, force: true });
      }
      await deleteUnique();
      return;
    } catch {
      /* fall through to rm below */
    }
  }
  await fs.promises.rm(cleanupPath, { recursive: true, force: true });
  await deleteUnique();
}

/**
 * Returns the first open PR whose head is `owner:branch` for this repo, or null.
 * @returns {Promise<null | { number: number, html_url: string, title: string, base_ref: string, draft: boolean }>}
 */
export async function getOpenPR(token, repoFullName, branch) {
  if (!token) return null;
  const [owner] = repoFullName.split('/');
  const res = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open&per_page=1`,
    { token }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const pr = data[0];
  return {
    number: pr.number,
    html_url: pr.html_url,
    title: pr.title,
    body: pr.body ?? null,
    base_ref: pr.base.ref,
    draft: Boolean(pr.draft),
  };
}

/**
 * Checks whether the worktree has uncommitted changes or commits not yet pushed
 * to any remote. Returns true if a git-sync turn should be injected.
 */
export async function worktreeNeedsSync(worktreePath) {
  try {
    await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, stdio: 'pipe' });
    const { stdout: staged } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
    });
    if (staged.trim()) return true;

    // Commits that exist locally but have no corresponding remote ref
    const { stdout: unpushed } = await execFileAsync(
      'git',
      ['log', '--oneline', 'HEAD', '--not', '--remotes'],
      { cwd: worktreePath }
    );
    return unpushed.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Checks whether the remote branch has commits that are not yet in the local branch.
 * Returns true if a pull-sync turn should be injected.
 */
export async function remoteHasNewCommits(worktreePath, remoteBranch, token, _repoFullName) {
  try {
    await gitWithToken(token, ['fetch', 'origin', remoteBranch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    const { stdout: behind } = await execFileAsync(
      'git',
      ['rev-list', '--count', `HEAD..origin/${remoteBranch}`],
      { cwd: worktreePath }
    );
    return parseInt(behind.trim(), 10) > 0;
  } catch {
    return false;
  }
}

// ─── Session-level git & PR helpers (used by session-socket) ──────────────────

export async function gitPull(worktreePath, remoteBranch, token) {
  try {
    await gitWithToken(token, ['ls-remote', '--exit-code', 'origin', remoteBranch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
  } catch {
    return { ok: true, message: 'Remote branch not found, skipping pull' };
  }

  await gitWithToken(token, ['pull', '--no-rebase', 'origin', remoteBranch], {
    cwd: worktreePath,
    stdio: 'pipe',
  });
  if (await lfsAvailable()) {
    try {
      await gitWithToken(token, ['lfs', 'pull'], { cwd: worktreePath, stdio: 'pipe' });
    } catch {
      /* repo may not use LFS */
    }
  }
  return { ok: true };
}

export async function gitFetch(worktreePath, token, branch) {
  const args = branch
    ? ['fetch', 'origin', `+${branch}:refs/remotes/origin/${branch}`]
    : ['fetch', '--all'];
  const { stdout: output } = await gitWithToken(token, args, {
    cwd: worktreePath,
    stdio: 'pipe',
  });
  return { ok: true, output: output || '' };
}

/**
 * Push the current HEAD to origin and return the branch name.
 * Throws with a `rejected` property if the push is rejected.
 */
export async function gitPush(
  worktreePath,
  token,
  { branch, force = false, forceOverwrite = false } = {}
) {
  const currentBranch = (
    await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath })
  ).stdout.trim();
  const targetBranch = branch ?? currentBranch;
  const refspec =
    !currentBranch || currentBranch === 'HEAD' || currentBranch === targetBranch
      ? targetBranch
      : `HEAD:${targetBranch}`;

  const pushArgs = ['push', '--set-upstream'];
  if (forceOverwrite) pushArgs.push('--force');
  else if (force) pushArgs.push('--force-with-lease');
  pushArgs.push('origin', refspec);

  try {
    await gitWithToken(token, pushArgs, {
      cwd: worktreePath,
      stdio: 'pipe',
    });
  } catch (pushErr) {
    const stderr = pushErr.stderr?.toString() ?? '';
    if (stderr.includes('[rejected]') || stderr.includes('Updates were rejected')) {
      const guidance =
        force || forceOverwrite
          ? 'Force push rejected: the remote ref has been updated since your last fetch. ' +
            'Call GitFetch to update your tracking refs, then try GitPush with force again.'
          : 'Push rejected: the remote has changes not present locally. ' +
            'Call GitPull to pull the latest changes, resolve any conflicts, then call GitPush again.';
      const err = new Error(`${guidance}\n\nOriginal error:\n${stderr.trim()}`);
      err.rejected = true;
      throw err;
    }
    throw pushErr;
  }

  return { ok: true, branch: targetBranch };
}

// 5 MB: unified diff is plain text, so 5 MB comfortably covers even very large
// sessions (thousands of changed lines across dozens of files). Beyond this the
// output is impractical to display in the browser anyway, and Node's default of
// 1 MB is too small for real-world diffs.
const MAX_DIFF_BUFFER_SIZE = 5 * 1024 * 1024;

/**
 * Returns the number of local commits not yet on the session remote branch.
 * When `remoteBranch` is set, counts `origin/<remoteBranch>..HEAD` so a unique
 * local worktree branch is not treated as fully unpushed. Falls back to
 * `HEAD --not --remotes` if that origin ref is missing (new branch never pushed).
 * @returns {Promise<number>}
 */
export async function gitCommitsToPush(worktreePath, remoteBranch = null) {
  try {
    if (remoteBranch) {
      try {
        await execFileAsync(
          'git',
          ['-C', worktreePath, 'rev-parse', '--verify', `origin/${remoteBranch}`],
          { maxBuffer: 256 }
        );
        const { stdout } = await execFileAsync(
          'git',
          ['-C', worktreePath, 'rev-list', '--count', `origin/${remoteBranch}..HEAD`],
          { maxBuffer: 256 }
        );
        return parseInt(stdout.trim(), 10) || 0;
      } catch {
        /* origin/<remoteBranch> missing — count commits not on any remote */
      }
    }
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'rev-list', '--count', 'HEAD', '--not', '--remotes'],
      { maxBuffer: 256 }
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Returns true if there are uncommitted changes in the worktree.
 * @returns {Promise<boolean>}
 */
export async function gitHasUncommitted(worktreePath) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'status', '--porcelain'], {
      maxBuffer: 256,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolves a ref to a short commit SHA.
 * @returns {Promise<string|null>}
 */
export async function gitRevParseShort(worktreePath, ref = 'HEAD') {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'rev-parse', '--short', ref],
      { maxBuffer: 256 }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Number of commits on HEAD not reachable from sinceRef (exclusive).
 * @returns {Promise<number>}
 */
export async function gitCommitCountSince(worktreePath, sinceRef) {
  if (!sinceRef) return 0;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'rev-list', '--count', `${sinceRef}..HEAD`],
      { maxBuffer: 256 }
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function mergeBaseWithBaseBranch(worktreePath, baseBranch) {
  if (!baseBranch) return null;
  let ref = `origin/${baseBranch}`;
  try {
    await execFileAsync('git', ['-C', worktreePath, 'rev-parse', '--verify', ref], {
      maxBuffer: 256,
      stdio: 'pipe',
    });
  } catch {
    ref = baseBranch;
  }
  const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'merge-base', 'HEAD', ref], {
    maxBuffer: 256,
  });
  return stdout.trim() || null;
}

/**
 * Commits on the session branch since merge-base with base branch.
 * @returns {Promise<number>}
 */
export async function gitCommitCountSinceBase(worktreePath, baseBranch) {
  try {
    const base = await mergeBaseWithBaseBranch(worktreePath, baseBranch);
    if (!base) return 0;
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'rev-list', '--count', `${base}..HEAD`],
      { maxBuffer: 256 }
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

const GIT_LOG_FIELD_SEP = '\x1e';
const GIT_LOG_RECORD_SEP = '\x1d';

/**
 * Parses `git log --format=…` output produced by gitLogSinceBase.
 * @returns {Array<{ sha: string, short_sha: string, subject: string, author_name: string, author_email: string, author_date: string }>}
 */
export function parseGitLogSinceBaseOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return trimmed
    .split(GIT_LOG_RECORD_SEP)
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha, short_sha, subject, author_name, author_email, author_date] =
        record.split(GIT_LOG_FIELD_SEP);
      return { sha, short_sha, subject, author_name, author_email, author_date };
    })
    .filter((commit) => Boolean(commit.sha));
}

/**
 * Commits on HEAD since merge-base with base branch (same range as session diff).
 * @returns {Promise<Array<{ sha: string, short_sha: string, subject: string, author_name: string, author_email: string, author_date: string }>>}
 */
export async function gitLogSinceBase(worktreePath, baseBranch, { limit = 100 } = {}) {
  try {
    const base = await mergeBaseWithBaseBranch(worktreePath, baseBranch);
    if (!base) return [];
    const { stdout } = await execFileAsync(
      'git',
      [
        '-C',
        worktreePath,
        'log',
        `${base}..HEAD`,
        `-n`,
        String(limit),
        `--format=%H${GIT_LOG_FIELD_SEP}%h${GIT_LOG_FIELD_SEP}%s${GIT_LOG_FIELD_SEP}%an${GIT_LOG_FIELD_SEP}%ae${GIT_LOG_FIELD_SEP}%aI${GIT_LOG_RECORD_SEP}`,
      ],
      { maxBuffer: 1024 * 512 }
    );
    return parseGitLogSinceBaseOutput(stdout);
  } catch {
    return [];
  }
}

/**
 * Returns the short SHA of HEAD and of a remote ref.
 * If remoteBranch is provided, resolves `origin/<remoteBranch>`; otherwise uses `@{u}`.
 * @returns {Promise<{ localSha: string|null, remoteSha: string|null }>}
 */
export async function gitLocalAndRemoteSha(worktreePath, remoteBranch = null) {
  const remoteRef = remoteBranch ? `origin/${remoteBranch}` : '@{u}';
  const [localResult, remoteResult] = await Promise.allSettled([
    execFileAsync('git', ['-C', worktreePath, 'rev-parse', '--short', 'HEAD'], {
      maxBuffer: 256,
    }),
    execFileAsync('git', ['-C', worktreePath, 'rev-parse', '--short', remoteRef], {
      maxBuffer: 256,
    }),
  ]);
  return {
    localSha: localResult.status === 'fulfilled' ? localResult.value.stdout.trim() || null : null,
    remoteSha:
      remoteResult.status === 'fulfilled' ? remoteResult.value.stdout.trim() || null : null,
  };
}

/**
 * Prefer origin/<baseBranch> for merge-base; fall back to the local branch ref
 * for local repos that have no remote or where origin hasn't been fetched.
 */
async function gitMergeBaseWithBase(worktreePath, baseBranch) {
  let ref = `origin/${baseBranch}`;
  try {
    await execFileAsync('git', ['-C', worktreePath, 'rev-parse', '--verify', ref], {
      maxBuffer: 256,
      stdio: 'pipe',
    });
  } catch {
    ref = baseBranch;
  }
  const { stdout: mergeBase } = await execFileAsync(
    'git',
    ['-C', worktreePath, 'merge-base', 'HEAD', ref],
    { maxBuffer: 256 }
  );
  return mergeBase.trim();
}

function parseNumstatCount(value) {
  if (value === '-' || value === '') return 0;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse `git diff --numstat -z` / `git show --numstat -z --format=` output.
 * @returns {{ old_path: string, new_path: string, added_count: number, removed_count: number }[]}
 */
export function parseGitNumstat(stdout) {
  const files = [];
  if (!stdout) return files;
  let i = 0;
  const s = stdout;
  while (i < s.length) {
    while (i < s.length && (s[i] === '\n' || s[i] === '\r' || s[i] === '\0')) i++;
    if (i >= s.length) break;
    const tab1 = s.indexOf('\t', i);
    if (tab1 === -1) break;
    const addedStr = s.slice(i, tab1);
    const tab2 = s.indexOf('\t', tab1 + 1);
    const nulAfterRemoved = s.indexOf('\0', tab1 + 1);
    let removedStr;
    let oldPath;
    let newPath;
    const isRename = nulAfterRemoved !== -1 && (tab2 === -1 || nulAfterRemoved < tab2);
    if (isRename) {
      removedStr = s.slice(tab1 + 1, nulAfterRemoved);
      const oldStart = nulAfterRemoved + 1;
      const oldEnd = s.indexOf('\0', oldStart);
      if (oldEnd === -1) break;
      oldPath = s.slice(oldStart, oldEnd);
      const newStart = oldEnd + 1;
      const newEnd = s.indexOf('\0', newStart);
      if (newEnd === -1) break;
      newPath = s.slice(newStart, newEnd);
      i = newEnd + 1;
    } else {
      if (tab2 === -1) break;
      removedStr = s.slice(tab1 + 1, tab2);
      const pathStart = tab2 + 1;
      const pathEnd = s.indexOf('\0', pathStart);
      const path =
        pathEnd === -1 ? s.slice(pathStart).replace(/[\n\r]+$/, '') : s.slice(pathStart, pathEnd);
      if (!path) {
        i = pathEnd === -1 ? s.length : pathEnd + 1;
        continue;
      }
      oldPath = path;
      newPath = path;
      i = pathEnd === -1 ? s.length : pathEnd + 1;
    }
    files.push({
      old_path: oldPath,
      new_path: newPath,
      added_count: parseNumstatCount(addedStr),
      removed_count: parseNumstatCount(removedStr),
    });
  }
  return files;
}

/**
 * Returns the unified diff between baseBranch and HEAD in the worktree.
 * @returns {Promise<string>}
 */
export async function gitDiff(
  worktreePath,
  baseBranch,
  { maxBuffer = MAX_DIFF_BUFFER_SIZE, filePath } = {}
) {
  try {
    const mergeBase = await gitMergeBaseWithBase(worktreePath, baseBranch);
    const args = ['-C', worktreePath, 'diff', mergeBase];
    if (filePath) args.push('--', filePath);
    const { stdout } = await execFileAsync('git', args, { maxBuffer });
    return stdout;
  } catch (err) {
    // Non-zero exit still produces stdout in some cases (e.g. binary files)
    if (err.stdout) return err.stdout;
    throw err;
  }
}

/**
 * Unified diff for a single commit (`git show`).
 * @returns {Promise<string>}
 */
export async function gitShowCommitDiff(
  worktreePath,
  commitSha,
  { maxBuffer = MAX_DIFF_BUFFER_SIZE } = {}
) {
  const sha = String(commitSha).trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return '';
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'show', '--format=', '--no-color', sha],
      { maxBuffer }
    );
    return stdout;
  } catch (err) {
    if (err.stdout) return err.stdout;
    return '';
  }
}

/**
 * Per-file added/removed counts vs merge-base (includes uncommitted changes).
 * @returns {Promise<ReturnType<typeof parseGitNumstat>>}
 */
export async function gitDiffNumstat(
  worktreePath,
  baseBranch,
  { maxBuffer = MAX_DIFF_BUFFER_SIZE } = {}
) {
  try {
    const mergeBase = await gitMergeBaseWithBase(worktreePath, baseBranch);
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'diff', '--numstat', '-z', mergeBase],
      { maxBuffer, encoding: 'utf8' }
    );
    return parseGitNumstat(stdout);
  } catch (err) {
    if (err.stdout) return parseGitNumstat(String(err.stdout));
    throw err;
  }
}

/**
 * Per-file added/removed counts for a single commit.
 * @returns {Promise<ReturnType<typeof parseGitNumstat>>}
 */
export async function gitShowCommitNumstat(
  worktreePath,
  commitSha,
  { maxBuffer = MAX_DIFF_BUFFER_SIZE } = {}
) {
  const sha = String(commitSha).trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return [];
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'show', '--format=', '--numstat', '-z', '--no-color', sha],
      { maxBuffer, encoding: 'utf8' }
    );
    return parseGitNumstat(stdout);
  } catch (err) {
    if (err.stdout) return parseGitNumstat(String(err.stdout));
    return [];
  }
}

/**
 * Fetches the current status of a pull request.
 * @returns {'open' | 'draft' | 'closed' | 'merged'}
 */
export async function getPRStatus(token, repoFullName, prNumber) {
  const res = await githubFetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, {
    token,
  });
  if (!res.ok) throw new Error('Failed to fetch PR status');
  const data = await res.json();
  if (data.merged) return 'merged';
  if (data.state === 'closed') return 'closed';
  if (data.draft) return 'draft';
  return 'open';
}

async function fetchPullRequestNodeId(token, repoFullName, prNumber) {
  const prRes = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`,
    { token }
  );
  if (!prRes.ok) throw new Error('Failed to fetch PR node ID');
  const { node_id } = await prRes.json();
  if (!node_id) throw new Error('Failed to fetch PR node ID');
  return node_id;
}

async function runPullRequestGraphqlMutation(token, query, nodeId, errorMessage) {
  const gqlRes = await githubFetch('https://api.github.com/graphql', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { id: nodeId },
    }),
  });
  if (!gqlRes.ok) throw new Error(errorMessage);
  const gqlData = await gqlRes.json();
  if (gqlData.errors?.length) throw new Error(gqlData.errors[0].message);
}

/**
 * Converts a draft PR to ready for review via the GitHub GraphQL API.
 */
export async function markPRReady(token, repoFullName, prNumber) {
  const node_id = await fetchPullRequestNodeId(token, repoFullName, prNumber);
  await runPullRequestGraphqlMutation(
    token,
    `mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }`,
    node_id,
    'Failed to mark PR as ready for review'
  );
}

/**
 * Converts an open PR to draft via the GitHub GraphQL API.
 */
export async function markPRDraft(token, repoFullName, prNumber) {
  const node_id = await fetchPullRequestNodeId(token, repoFullName, prNumber);
  await runPullRequestGraphqlMutation(
    token,
    `mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { isDraft } } }`,
    node_id,
    'Failed to mark PR as draft'
  );
}

/**
 * Squash-merges a pull request via the GitHub API.
 */
export async function mergePR(token, repoFullName, prNumber) {
  const res = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/merge`,
    {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method: 'squash' }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || 'Failed to merge PR');
  }
}

/**
 * Fetches a single PR by number. Throws if not found or request fails.
 * @returns {{ number, html_url, title, body, state, draft, author, head: { ref }, base: { ref }, labels, created_at, updated_at, merged_at }}
 */
export async function getOpenPRByNumber(token, repoFullName, prNumber) {
  const res = await githubFetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, {
    token,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch PR #${prNumber}: ${res.status} ${text}`);
  }
  const data = await res.json();
  return {
    number: data.number,
    html_url: data.html_url,
    title: data.title,
    body: data.body || '',
    state: data.state,
    draft: data.draft,
    author: data.user?.login,
    head: { ref: data.head.ref },
    base: { ref: data.base.ref },
    labels: data.labels?.map((l) => l.name) ?? [],
    created_at: data.created_at,
    updated_at: data.updated_at,
    merged_at: data.merged_at,
  };
}

/**
 * Lists comments on a PR: the conversation thread plus inline review comments on the diff.
 *
 * GitHub stores every pull request as an issue (same numeric id). Comments on the main PR
 * “Conversation” tab are therefore **issue comments** (`/issues/{n}/comments`), not pull
 * comments. Inline feedback on files uses the pull review comments API (`/pulls/{n}/comments`).
 *
 * @returns {{ issueComments: object[], reviewComments: object[] }}
 */
export async function getPRComments(token, repoFullName, prNumber) {
  const ghInit = { token, accept: 'application/vnd.github+json' };
  const mapComment = (c) => ({
    id: c.id,
    user: c.user?.login,
    body: c.body,
    created_at: c.created_at,
    html_url: c.html_url,
  });
  const mapReviewComment = (c) => ({
    id: c.id,
    user: c.user?.login,
    body: c.body,
    path: c.path,
    line: c.line ?? c.original_line,
    created_at: c.created_at,
    html_url: c.html_url,
  });

  const [issueRes, reviewRes] = await Promise.all([
    // PR conversation thread — same resource as issue comments because PR #n === issue #n
    githubFetch(
      `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments?per_page=100`,
      ghInit
    ),
    githubFetch(
      `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/comments?per_page=100`,
      ghInit
    ),
  ]);

  const issueComments = issueRes.ok
    ? (await issueRes.json()).filter((c) => !(c.reactions?.eyes > 0)).map(mapComment)
    : [];
  const reviewComments = reviewRes.ok
    ? (await reviewRes.json()).filter((c) => !(c.reactions?.eyes > 0)).map(mapReviewComment)
    : [];
  return { issueComments, reviewComments };
}

/**
 * Adds a reaction to a PR comment (issue comment or review comment).
 * @param {'issue'|'review'} commentType
 * @param {string} content - GitHub reaction type, e.g. 'eyes'
 */
export async function addReactionToComment(
  token,
  repoFullName,
  commentId,
  commentType,
  content = 'eyes'
) {
  const endpoint =
    commentType === 'review'
      ? `https://api.github.com/repos/${repoFullName}/pulls/comments/${commentId}/reactions`
      : `https://api.github.com/repos/${repoFullName}/issues/comments/${commentId}/reactions`;
  const res = await githubFetch(endpoint, {
    method: 'POST',
    token,
    accept: 'application/vnd.github+json',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to add reaction: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Posts an issue comment on a PR.
 * @returns {{ id, url, body }}
 */
export async function createPRComment(token, repoFullName, prNumber, body) {
  const res = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to post PR comment: ${res.status} ${text}`);
  }
  const data = await res.json();
  return { id: data.id, url: data.html_url, body: data.body };
}

/**
 * Posts an inline review comment on a specific line of a PR.
 * @returns {{ id, url, body }}
 */
export async function createPRLineComment(
  token,
  repoFullName,
  prNumber,
  { body, path, line, commitId, side = 'RIGHT' }
) {
  const res = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/comments`,
    {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, path, line, commit_id: commitId, side }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to post inline PR comment: ${res.status} ${text}`);
  }
  const data = await res.json();
  return { id: data.id, url: data.html_url, body: data.body, path: data.path, line: data.line };
}

/**
 * Submits a PR review.
 * @param {string} event - 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
 * @param {Array<{body, path, line, side?}>} [comments] - Optional inline comments to include in the review
 * @param {string} [commitId] - Required when comments are provided
 * @returns {{ id, state, body }}
 */
export async function createPRReview(
  token,
  repoFullName,
  prNumber,
  event,
  body,
  comments = [],
  commitId = null
) {
  const payload = { body, event };
  if (comments.length > 0) {
    payload.comments = comments.map((c) => ({
      path: c.path,
      line: c.line,
      body: c.body,
      side: c.side || 'RIGHT',
    }));
    if (commitId) payload.commit_id = commitId;
  }
  const res = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/reviews`,
    {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to submit PR review: ${res.status} ${text}`);
  }
  const data = await res.json();
  return { id: data.id, state: data.state, body: data.body };
}

function mapWorkflowJob(job) {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    html_url: job.html_url,
  };
}

async function fetchWorkflowRunJobs(token, repoFullName, runId) {
  const jobsRes = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/actions/runs/${runId}/jobs?per_page=100`,
    { token }
  );
  if (!jobsRes.ok) return [];
  const jobsData = await jobsRes.json();
  return (jobsData.jobs || []).map(mapWorkflowJob);
}

function mapWorkflowRun(r, jobs) {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    html_url: r.html_url,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at ?? null,
    path: r.path,
    event: r.event,
    head_sha: r.head_sha,
    run_attempt: r.run_attempt,
    jobs,
  };
}

function normalizeGraphqlEnum(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function mapStatusContextState(state) {
  const s = normalizeGraphqlEnum(state);
  if (s === 'success') return 'success';
  if (s === 'failure' || s === 'error') return 'failure';
  if (s === 'pending' || s === 'expected') return 'pending';
  return s;
}

/**
 * PR head check rollup (Actions check runs + legacy commit statuses), aligned with the PR checks UI.
 * @returns {{ checks: Array<{ name, conclusion, status, required, app, html_url }>, head_sha: string | null }}
 */
async function fetchPRCheckRollup(token, repoFullName, prNumber) {
  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) return { checks: [], head_sha: null };

  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          commits(last: 1) {
            nodes {
              commit {
                oid
                statusCheckRollup {
                  contexts(first: 100) {
                    nodes {
                      __typename
                      ... on CheckRun {
                        name
                        conclusion
                        status
                        isRequired
                        detailsUrl
                        checkSuite { app { name slug } }
                      }
                      ... on StatusContext {
                        context
                        state
                        isRequired
                        targetUrl
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const res = await githubFetch('https://api.github.com/graphql', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { owner, repo, number: prNumber },
    }),
  });
  if (!res.ok) return { checks: [], head_sha: null };
  const data = await res.json();
  if (data.errors?.length) return { checks: [], head_sha: null };

  const commit = data?.data?.repository?.pullRequest?.commits?.nodes?.[0]?.commit;
  if (!commit) return { checks: [], head_sha: null };

  const head_sha = commit.oid;
  const nodes = commit.statusCheckRollup?.contexts?.nodes ?? [];
  const checks = nodes
    .map((node) => {
      if (node.__typename === 'CheckRun') {
        const app = node.checkSuite?.app;
        return {
          name: node.name,
          conclusion: normalizeGraphqlEnum(node.conclusion),
          status: normalizeGraphqlEnum(node.status),
          required: Boolean(node.isRequired),
          app: app?.name ?? app?.slug ?? null,
          html_url: node.detailsUrl ?? null,
        };
      }
      if (node.__typename === 'StatusContext') {
        return {
          name: node.context,
          conclusion: mapStatusContextState(node.state),
          status: null,
          required: Boolean(node.isRequired),
          app: null,
          html_url: node.targetUrl ?? null,
        };
      }
      return null;
    })
    .filter(Boolean);

  return { checks, head_sha };
}

/**
 * Recent workflow runs for a branch (with jobs) plus optional PR-head check rollup.
 * @returns {{ runs: Array<object>, checks: Array<object>, head_sha: string | null }}
 */
export async function getPRWorkflows(token, repoFullName, branch, { prNumber } = {}) {
  const url = `https://api.github.com/repos/${repoFullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=10`;
  const res = await githubFetch(url, { token });
  const runsRaw = res.ok ? (await res.json()).workflow_runs || [] : [];

  const runs = await Promise.all(
    runsRaw.map(async (r) => {
      const jobs = await fetchWorkflowRunJobs(token, repoFullName, r.id);
      return mapWorkflowRun(r, jobs);
    })
  );

  let checks = [];
  let head_sha = null;
  if (prNumber) {
    const rollup = await fetchPRCheckRollup(token, repoFullName, prNumber);
    checks = rollup.checks;
    head_sha = rollup.head_sha;
  }

  return { runs, checks, head_sha };
}

/**
 * Fetches logs for failed jobs (or all jobs if none failed) in a workflow run.
 * Supports byte-range pagination: pass startByte/endByte to read specific chunks.
 * By default returns the last DEFAULT_LOG_BYTES bytes (where errors appear).
 *
 * @returns {{ jobs: Array<{ id, name, status, conclusion, log, totalBytes, startByte, endByte }> }}
 */
export async function getPRWorkflowLogs(token, repoFullName, runId, { startByte, endByte } = {}) {
  const validationError = validateLogByteRange({ startByte, endByte });
  if (validationError) {
    throw new Error(validationError);
  }

  const jobsRes = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/actions/runs/${runId}/jobs?per_page=30`,
    { token }
  );
  if (!jobsRes.ok) {
    throw new Error(`Failed to fetch jobs for run ${runId}: ${jobsRes.status}`);
  }
  const jobsData = await jobsRes.json();
  const allJobs = jobsData.jobs || [];

  // Focus on failed jobs; fall back to all jobs if none failed
  const failedJobs = allJobs.filter(
    (j) => j.conclusion === 'failure' || j.conclusion === 'timed_out'
  );
  const targetJobs = failedJobs.length > 0 ? failedJobs : allJobs;

  const results = await Promise.all(
    targetJobs.map(async (job) => {
      // Step 1: get the redirect URL for this job's logs (GitHub returns 302)
      const logRes = await githubFetch(
        `https://api.github.com/repos/${repoFullName}/actions/jobs/${job.id}/logs`,
        { token, redirect: 'manual' }
      );
      const logUrl = logRes.headers.get('location');
      if (!logUrl) {
        return {
          id: job.id,
          name: job.name,
          status: job.status,
          conclusion: job.conclusion,
          log: '(log unavailable)',
          totalBytes: 0,
          startByte: 0,
          endByte: 0,
        };
      }

      const rangeHeader = buildLogRangeHeader({ startByte, endByte });

      // Signed blob URL from the redirect — do not send the GitHub token (Azure rejects it).
      const rangeRes = await githubFetch(logUrl, { headers: { Range: rangeHeader } });
      let log = await rangeRes.text();

      let totalBytes = Buffer.byteLength(log, 'utf8');
      let actualStart = 0;
      let actualEnd = Math.max(0, totalBytes - 1);

      const contentRange = rangeRes.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
        if (match) {
          actualStart = parseInt(match[1], 10);
          actualEnd = parseInt(match[2], 10);
          totalBytes = parseInt(match[3], 10);
        }
      }

      if (rangeNeedsFullLogFetch({ startByte, endByte })) {
        const sliced = sliceByteRange(log, { startByte, endByte });
        log = sliced.log;
        totalBytes = sliced.totalBytes;
        actualStart = sliced.startByte;
        actualEnd = sliced.endByte;
      } else if (startByte != null && endByte != null) {
        const span = actualEnd - actualStart + 1;
        if (span > MAX_LOG_RANGE_BYTES) {
          actualEnd = actualStart + MAX_LOG_RANGE_BYTES - 1;
          log = Buffer.from(log, 'utf8').subarray(0, MAX_LOG_RANGE_BYTES).toString('utf8');
        }
      }

      return {
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        log,
        totalBytes,
        startByte: actualStart,
        endByte: actualEnd,
      };
    })
  );

  return { jobs: results };
}

/**
 * Create or update a pull request via the GitHub API.
 * @returns {{ url: string, number: number }}
 */
export async function upsertPR(
  token,
  { repoFullName, prNumber, title, body, head, baseBranch, reopen = false }
) {
  if (prNumber) {
    const patchBody = { title, body };
    if (reopen) patchBody.state = 'open';
    const res = await githubFetch(
      `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`,
      {
        method: 'PATCH',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub PATCH failed: ${text}`);
    }
    const data = await res.json();
    return { url: data.html_url, number: data.number };
  }

  const res = await githubFetch(`https://api.github.com/repos/${repoFullName}/pulls`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, head, base: baseBranch, draft: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub POST failed: ${text}`);
  }
  const data = await res.json();
  return { url: data.html_url, number: data.number };
}

export async function listRepoPRs(
  token,
  repoFullName,
  { state = 'open', author, label, base, text } = {}
) {
  if (author || label || text) {
    const parts = ['is:pr', `repo:${repoFullName}`, `is:${state}`];
    if (author) parts.push(`author:${author}`);
    if (label) parts.push(`label:${label}`);
    if (text) parts.push(text);
    const q = encodeURIComponent(parts.join(' '));
    const res = await githubFetch(
      `https://api.github.com/search/issues?q=${q}&per_page=30&sort=updated`,
      { token }
    );
    if (!res.ok) throw new Error(`GitHub API error: ${await res.text()}`);
    const data = await res.json();
    return data.items.map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: pr.user?.login,
      state: pr.state,
      html_url: pr.html_url,
      labels: pr.labels?.map((l) => l.name) ?? [],
      updated_at: pr.updated_at,
    }));
  }

  const params = new URLSearchParams({ state, sort: 'updated', per_page: '50' });
  if (base) params.set('base', base);
  const res = await githubFetch(`https://api.github.com/repos/${repoFullName}/pulls?${params}`, {
    token,
  });
  if (!res.ok) throw new Error(`GitHub API error: ${await res.text()}`);
  const prs = await res.json();
  return prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login,
    state: pr.state,
    html_url: pr.html_url,
    draft: pr.draft,
    head: pr.head.ref,
    base: pr.base.ref,
    labels: pr.labels?.map((l) => l.name) ?? [],
    updated_at: pr.updated_at,
  }));
}

export async function addLabelsToPR(token, repoFullName, prNumber, labels) {
  const res = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/labels`,
    { method: 'POST', token, body: JSON.stringify({ labels }) }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${await res.text()}`);
  const data = await res.json();
  return data.map((l) => l.name);
}

export async function listRepoTags(token, repoFullName) {
  const res = await githubFetch(`https://api.github.com/repos/${repoFullName}/tags?per_page=50`, {
    token,
  });
  if (!res.ok) throw new Error(`GitHub API error: ${await res.text()}`);
  const tags = await res.json();
  return tags.map((t) => ({ name: t.name, sha: t.commit?.sha }));
}

export const BAGUETTE_DESCRIPTION_MARKER = '<!-- baguette -->';
export const BAGUETTE_FOOTER_MARKER = '<!-- baguette-footer -->';

const LEGACY_FOOTER_RE = /\n\n---\n_[\s\S]*?_\s*$/;

function stripBaguetteFooter(text) {
  const idx = text.indexOf(BAGUETTE_FOOTER_MARKER);
  let content =
    idx >= 0 ? text.slice(0, idx).trimEnd() : text.replace(LEGACY_FOOTER_RE, '').trimEnd();
  return content.replace(/\n*---\s*$/, '').trimEnd();
}

export function splitPrBody(body) {
  const idx = (body ?? '').indexOf(BAGUETTE_DESCRIPTION_MARKER);
  if (idx < 0) return { userPrefix: '', baguetteContent: body ?? '' };
  const userPrefix = body.slice(0, idx).trimEnd();
  const afterMarker = body.slice(idx + BAGUETTE_DESCRIPTION_MARKER.length).trimStart();
  const withoutDivider = afterMarker.replace(/^---\n+/, '');
  const baguetteContent = stripBaguetteFooter(withoutDivider);
  return { userPrefix, baguetteContent };
}

export function buildSessionFooter(_session, { previewUrl = null, usageLines = [] } = {}) {
  const lines = [];
  if (previewUrl) lines.push(`Preview: ${previewUrl}`);
  if (usageLines?.length) lines.push(...usageLines);
  if (!lines.length) return '';

  const italicLines = lines.map((line) => `_${line}_`);
  return `\n\n---\n\n${BAGUETTE_FOOTER_MARKER}\n\n${italicLines.join('\n')}`;
}

export function buildPrBody(userPrefix, baguetteContent, footer = '') {
  const baguetteSection = `${BAGUETTE_DESCRIPTION_MARKER}\n---\n\n${baguetteContent}${footer}`;
  return userPrefix ? `${userPrefix}\n\n${baguetteSection}` : baguetteSection;
}
