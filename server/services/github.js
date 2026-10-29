import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { REPOS_DIR, resolveRepoPath, resolveDataDirRelativePath } from '../config.js';
import * as cache from '../lib/cache.js';
import {
  buildLogRangeHeader,
  MAX_LOG_RANGE_BYTES,
  rangeNeedsFullLogFetch,
  sliceByteRange,
  validateLogByteRange,
} from './mcp-pagination.js';
import { githubFetch } from './github-api.js';
import { gitHubOriginFromFullName } from '../../shared/repo-origin.js';

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
  const url = gitHubOriginFromFullName(repoFullName);
  if (!url) throw new Error(`Not a GitHub repository full name: ${repoFullName}`);
  return url;
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

/** Base directory for all repo data (worktrees, main clone): `<REPOS_DIR>/<stripped>/` */
function repoDirPath(strippedName) {
  return path.join(REPOS_DIR, strippedName);
}

function mainRepoPathForStripped(strippedName) {
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
 * Ensures the main repo clone exists on disk (`repos/<stripped>/main`, full checkout).
 * If already cloned, returns the path immediately. Otherwise clones from GitHub.
 *
 * @param {object} repo - { full_name, stripped_name, repo_path? }
 * @param {string} token
 */
export async function ensureMainClone(repo, token) {
  const mainRepoPath = resolveRepoPath(repo) ?? mainRepoPathForStripped(repo.stripped_name);

  try {
    await fs.promises.access(mainRepoPath);
    return mainRepoPath;
  } catch {
    /* clone not present yet */
  }

  await fs.promises.mkdir(path.dirname(mainRepoPath), { recursive: true });
  try {
    await fs.promises.rm(mainRepoPath, { recursive: true, force: true });
  } catch {
    /* path may not exist */
  }
  await gitWithToken(token, ['clone', repoUrl(repo.full_name), mainRepoPath], {
    stdio: 'pipe',
  });
  if (await lfsAvailable()) {
    try {
      await gitWithToken(token, ['lfs', 'fetch', '--all'], { cwd: mainRepoPath, stdio: 'pipe' });
    } catch {
      /* repo may not use LFS */
    }
  }
  return mainRepoPath;
}

/**
 * Initialize a brand-new local git repo with an empty initial commit.
 * Returns the repo path (same convention as repo_path).
 */
export async function initLocalRepo(strippedName) {
  const repoPath = mainRepoPathForStripped(strippedName);
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
  const repoPath = mainRepoPathForStripped(strippedName);
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
  const mainRepoPath = resolveRepoPath(repo);
  if (!mainRepoPath) {
    throw new Error(`Repository "${repo?.full_name ?? repo?.stripped_name}" has no repo_path`);
  }
  const worktreePath = path.join(REPOS_DIR, repo.stripped_name, 'sessions', worktreeId, 'worktree');
  await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });

  // Fetch into a session-unique temp ref to:
  // 1. Avoid "refusing to fetch into branch checked out at ..." — the temp ref is never
  //    checked out in any worktree so git never blocks the fetch.
  // 2. Capture the exact remote SHA so we can update the (potentially stale) local branch ref.
  const tempRef = `refs/baguette-fetch/${worktreeId}`;
  try {
    await gitWithToken(token, ['fetch', 'origin', `+${branch}:${tempRef}`], {
      cwd: mainRepoPath,
      stdio: 'pipe',
    });
  } catch (err) {
    if (!isMissingRemoteRefError(err)) throw err;
    // No origin or branch never pushed — use existing local branch ref as-is
  }
  // Sync the local branch ref to the fetched commit so new worktrees start from the latest
  // remote commit rather than the stale commit from when the main clone was created.
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', tempRef], {
      cwd: mainRepoPath,
      stdio: 'pipe',
    });
    await execFileAsync('git', ['update-ref', `refs/heads/${branch}`, stdout.trim()], {
      cwd: mainRepoPath,
      stdio: 'pipe',
    });
  } catch {
    /* fall back to existing local ref */
  }
  // Clean up temp ref (best-effort)
  try {
    await execFileAsync('git', ['update-ref', '-d', tempRef], { cwd: mainRepoPath, stdio: 'pipe' });
  } catch {
    /* ignore */
  }

  // Also fetch the base branch so origin/<baseBranch> is up to date for merge-base diffs
  if (baseBranch && baseBranch !== branch) {
    try {
      await gitWithToken(
        token,
        ['fetch', 'origin', `+${baseBranch}:refs/remotes/origin/${baseBranch}`],
        { cwd: mainRepoPath, stdio: 'pipe' }
      );
    } catch {
      /* local repo with no remote — skip */
    }
  }

  if (await lfsAvailable()) {
    try {
      await gitWithToken(token, ['lfs', 'fetch', 'origin', branch], {
        cwd: mainRepoPath,
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
      cwd: mainRepoPath,
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
function resolveSessionWorktreePath(session, repo) {
  const fromDb = resolveDataDirRelativePath(session?.session_path);
  if (fromDb) return fromDb;
  const stripped = repo?.stripped_name || (repo?.full_name ? toStrippedName(repo.full_name) : null);
  if (session?.short_id && stripped) {
    return path.join(REPOS_DIR, stripped, 'sessions', session.short_id, 'worktree');
  }
  return null;
}

async function tryDeleteUniqueLocalBranch(mainRepoPath, session) {
  const localBranch = session?.local_branch;
  const remoteBranch = session?.remote_branch;
  if (!mainRepoPath || !localBranch || !remoteBranch || localBranch === remoteBranch) return;
  try {
    await execFileAsync('git', ['branch', '-D', localBranch], {
      cwd: mainRepoPath,
      stdio: 'pipe',
    });
  } catch {
    /* missing ref or still checked out — archive must not fail */
  }
}

/**
 * @param {{ keepLocalBranch?: boolean }} [options]
 *   When archiving, pass `keepLocalBranch: true` so restore can recreate the worktree from the
 *   session-specific local ref.
 */
export async function removeWorktree(session, repo, options = {}) {
  const keepLocalBranch = !!options.keepLocalBranch;
  // Global sessions use the shared REPOS_DIR as cwd — never delete it.
  if (session?.is_global) return;
  const absoluteWorktreePath = resolveSessionWorktreePath(session, repo);
  const maybeDeleteUnique = async () => {
    if (!keepLocalBranch) {
      await tryDeleteUniqueLocalBranch(resolveRepoPath(repo), session);
    }
  };
  if (!absoluteWorktreePath) {
    await maybeDeleteUnique();
    return;
  }
  if (path.resolve(absoluteWorktreePath) === path.resolve(REPOS_DIR)) return;
  try {
    await fs.promises.access(absoluteWorktreePath);
  } catch {
    await maybeDeleteUnique();
    return;
  }

  // New structure: worktree lives at .../sessions/<id>/worktree — clean the whole session dir.
  const isNewStructure = path.basename(absoluteWorktreePath) === 'worktree';
  const cleanupPath = isNewStructure ? path.dirname(absoluteWorktreePath) : absoluteWorktreePath;

  const mainRepoPath = resolveRepoPath(repo);
  if (mainRepoPath) {
    try {
      await fs.promises.access(mainRepoPath);
      await execFileAsync('git', ['worktree', 'remove', '--force', absoluteWorktreePath], {
        cwd: mainRepoPath,
        stdio: 'pipe',
      });
      if (isNewStructure) {
        await fs.promises.rm(cleanupPath, { recursive: true, force: true });
      }
      await maybeDeleteUnique();
      return;
    } catch {
      /* fall through to rm below */
    }
  }
  await fs.promises.rm(cleanupPath, { recursive: true, force: true });
  await maybeDeleteUnique();
}

/** Prefer the archived session's unique local ref when it still exists in the main repo clone. */
export async function resolveRestoreWorktreeBranches(mainRepoPath, session) {
  const remoteBranch = session.remote_branch;
  const localBranch = session.local_branch;
  if (localBranch && localBranch !== remoteBranch && mainRepoPath) {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', `refs/heads/${localBranch}`], {
        cwd: mainRepoPath,
        stdio: 'pipe',
      });
      return { branch: localBranch, localBranch };
    } catch {
      /* fall through */
    }
  }
  const branch = remoteBranch || localBranch;
  if (!branch) {
    return { branch: null, localBranch: null };
  }
  const resolvedLocal = localBranch || uniqueLocalBranch(branch, session.short_id) || branch;
  return { branch, localBranch: resolvedLocal };
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
    if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw err;
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
  { maxBuffer = MAX_DIFF_BUFFER_SIZE, filePath } = {}
) {
  const sha = String(commitSha).trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return '';
  const args = ['-C', worktreePath, 'show', '--format=', '--no-color', sha];
  if (filePath) args.push('--', filePath);
  try {
    const { stdout } = await execFileAsync('git', args, { maxBuffer });
    return stdout;
  } catch (err) {
    if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw err;
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
/**
 * Closes an open or draft pull request via the GitHub API.
 */
export async function closePR(token, repoFullName, prNumber) {
  const res = await githubFetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, {
    method: 'PATCH',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || 'Failed to close PR');
  }
}

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

/** @param {object} c GitHub comment or review payload with optional reactions. */
function isUnviewedPrComment(c) {
  return !((c.reactions?.eyes ?? 0) > 0);
}

/**
 * Paginated GitHub list endpoint; returns all items or failure metadata for page 1.
 * @returns {Promise<{ ok: true, items: object[] } | { ok: false, status: number, text: string }>}
 */
async function fetchGithubListPages(url, token, accept) {
  const items = [];
  let page = 1;
  while (true) {
    const separator = url.includes('?') ? '&' : '?';
    const res = await githubFetch(`${url}${separator}per_page=100&page=${page}`, {
      token,
      accept,
    });
    if (!res.ok) {
      if (page === 1) {
        const text = await res.text().catch(() => '');
        return { ok: false, status: res.status, text };
      }
      break;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    items.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return { ok: true, items };
}

/**
 * Lists comments on a PR: the conversation thread plus inline review comments on the diff.
 *
 * GitHub stores every pull request as an issue (same numeric id). Comments on the main PR
 * “Conversation” tab are therefore **issue comments** (`/issues/{n}/comments`), not pull
 * comments. Submitted PR reviews with a summary body (`/pulls/{n}/reviews`) also appear on
 * the conversation timeline but are not issue comments. Inline feedback on files uses the
 * pull review comments API (`/pulls/{n}/comments`).
 *
 * @returns {{ issueComments: object[], reviewComments: object[], warnings?: string[] }}
 */
export async function getPRComments(token, repoFullName, prNumber) {
  const ghAccept = 'application/vnd.github+json';
  const base = `https://api.github.com/repos/${repoFullName}`;
  const mapIssueComment = (c) => ({
    id: c.id,
    commentType: 'issue',
    user: c.user?.login,
    body: c.body,
    created_at: c.created_at,
    html_url: c.html_url,
  });
  const mapReviewBody = (r) => ({
    id: r.id,
    commentType: 'review_body',
    user: r.user?.login,
    body: r.body,
    state: r.state,
    created_at: r.submitted_at,
    html_url: r.html_url,
  });
  const mapReviewComment = (c) => ({
    id: c.id,
    commentType: 'review',
    user: c.user?.login,
    body: c.body,
    path: c.path,
    line: c.line ?? c.original_line,
    created_at: c.created_at,
    html_url: c.html_url,
  });

  const [issueResult, reviewResult, reviewsResult] = await Promise.all([
    fetchGithubListPages(`${base}/issues/${prNumber}/comments`, token, ghAccept),
    fetchGithubListPages(`${base}/pulls/${prNumber}/comments`, token, ghAccept),
    fetchGithubListPages(`${base}/pulls/${prNumber}/reviews`, token, ghAccept),
  ]);

  const warnings = [];
  if (!issueResult.ok) {
    warnings.push(
      `Could not load PR conversation comments via the issues API (HTTP ${issueResult.status}).` +
        (issueResult.text ? ` ${issueResult.text}` : '') +
        ' Ensure the GitHub App has repository Issues read access.'
    );
  }
  if (!reviewResult.ok) {
    warnings.push(
      `Could not load inline review comments (HTTP ${reviewResult.status}).` +
        (reviewResult.text ? ` ${reviewResult.text}` : '')
    );
  }

  const threadComments = issueResult.ok
    ? issueResult.items.filter(isUnviewedPrComment).map(mapIssueComment)
    : [];
  const reviewBodies = reviewsResult.ok
    ? reviewsResult.items
        .filter((r) => r.body?.trim())
        .filter(isUnviewedPrComment)
        .map(mapReviewBody)
    : [];
  const issueComments = [...threadComments, ...reviewBodies].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const reviewComments = reviewResult.ok
    ? reviewResult.items.filter(isUnviewedPrComment).map(mapReviewComment)
    : [];

  return warnings.length > 0
    ? { issueComments, reviewComments, warnings }
    : { issueComments, reviewComments };
}

/**
 * Adds a reaction to a PR comment (issue comment, inline review comment, or review summary).
 * @param {'issue'|'review'|'review_body'} commentType
 * @param {string} content - GitHub reaction type, e.g. 'eyes'
 * @param {number} [prNumber] - Required when commentType is `review_body`
 */
export async function addReactionToComment(
  token,
  repoFullName,
  commentId,
  commentType,
  content = 'eyes',
  prNumber = null
) {
  let endpoint;
  if (commentType === 'review') {
    endpoint = `https://api.github.com/repos/${repoFullName}/pulls/comments/${commentId}/reactions`;
  } else if (commentType === 'review_body') {
    if (!prNumber) throw new Error('prNumber is required for review_body reactions');
    endpoint = `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/reviews/${commentId}/reactions`;
  } else {
    endpoint = `https://api.github.com/repos/${repoFullName}/issues/comments/${commentId}/reactions`;
  }
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

function workflowRunCompletedAt(r) {
  if (r.completed_at) return r.completed_at;
  if (r.status === 'completed' && r.updated_at) return r.updated_at;
  return null;
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
    completed_at: workflowRunCompletedAt(r),
    path: r.path,
    event: r.event,
    head_sha: r.head_sha,
    run_attempt: r.run_attempt,
    jobs,
  };
}

const WORKFLOW_RUN_IN_FLIGHT_STATUSES = new Set([
  'queued',
  'in_progress',
  'waiting',
  'requested',
  'pending',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapGraphqlCheckNodes(nodes) {
  return nodes
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
}

/**
 * REST fallback for the check rollup, used when the GraphQL rollup is empty or
 * unavailable. Limitation: these endpoints do not expose branch-protection
 * state, so every check from this fallback reports `required: false`.
 * Callers surface `checks_source: 'rest'` so agents know `required` is unknown.
 */
async function fetchCommitChecksRest(token, repoFullName, sha) {
  const checks = [];

  const runsRes = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
    { token }
  );
  if (runsRes.ok) {
    const data = await runsRes.json();
    for (const cr of data.check_runs || []) {
      checks.push({
        name: cr.name,
        conclusion: normalizeGraphqlEnum(cr.conclusion),
        status: normalizeGraphqlEnum(cr.status),
        required: false,
        app: cr.app?.name ?? cr.app?.slug ?? null,
        html_url: cr.html_url ?? null,
      });
    }
  }

  const statusRes = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/commits/${encodeURIComponent(sha)}/status`,
    { token }
  );
  if (statusRes.ok) {
    const statusData = await statusRes.json();
    for (const st of statusData.statuses || []) {
      checks.push({
        name: st.context,
        conclusion: mapStatusContextState(st.state),
        status: null,
        required: false,
        app: null,
        html_url: st.target_url ?? null,
      });
    }
  }

  return checks;
}

async function fetchCommitCheckRollupGraphql(token, repoFullName, { prNumber, headSha }) {
  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) return { checks: [], head_sha: null };

  let query;
  let variables;
  if (prNumber != null) {
    query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            headRefTarget {
              ... on Commit {
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
    `;
    variables = { owner, repo, number: prNumber };
  } else if (headSha) {
    query = `
      query($owner: String!, $repo: String!, $oid: GitObjectID!) {
        repository(owner: $owner, name: $repo) {
          object(oid: $oid) {
            ... on Commit {
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
    `;
    variables = { owner, repo, oid: headSha };
  } else {
    return { checks: [], head_sha: null };
  }

  const res = await githubFetch('https://api.github.com/graphql', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) return { checks: [], head_sha: null };
  const data = await res.json();
  if (data.errors?.length) return { checks: [], head_sha: null };

  let commit;
  if (prNumber != null) {
    commit = data?.data?.repository?.pullRequest?.headRefTarget;
  } else {
    commit = data?.data?.repository?.object;
  }
  if (!commit?.oid) return { checks: [], head_sha: null };

  const nodes = commit.statusCheckRollup?.contexts?.nodes ?? [];
  return { checks: mapGraphqlCheckNodes(nodes), head_sha: commit.oid };
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
 * Uses GraphQL on the PR head commit, with REST fallback when rollup is empty.
 * `checks_source` reports which source produced the checks: 'graphql' (includes
 * branch-protection `required`), 'rest' (fallback; `required` is always false), or
 * null when neither source was consulted.
 * @returns {{ checks: Array<object>, head_sha: string | null, checks_source: 'graphql' | 'rest' | null }}
 */
async function fetchPRCheckRollup(token, repoFullName, { prNumber, headSha } = {}) {
  const graphql = await fetchCommitCheckRollupGraphql(token, repoFullName, {
    prNumber: prNumber ?? null,
    headSha: headSha ?? null,
  });
  let { checks, head_sha } = graphql;

  if (!head_sha) {
    if (headSha) {
      head_sha = headSha;
    } else if (prNumber != null) {
      const prRes = await githubFetch(
        `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`,
        { token }
      );
      if (prRes.ok) {
        const pr = await prRes.json();
        head_sha = pr.head?.sha ?? null;
      }
    }
  }

  let checks_source = 'graphql';
  if (checks.length === 0) {
    if (head_sha) {
      checks = await fetchCommitChecksRest(token, repoFullName, head_sha);
      checks_source = 'rest';
    } else {
      checks_source = null;
    }
  }

  return { checks, head_sha, checks_source };
}

async function loadWorkflowRunsForBranch(token, repoFullName, branch, perPage) {
  const url = `https://api.github.com/repos/${repoFullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=${perPage}`;
  const res = await githubFetch(url, { token });
  if (!res.ok) return { ok: false, runs: [] };
  let runsRaw = [];
  try {
    runsRaw = (await res.json()).workflow_runs || [];
  } catch {
    return { ok: false, runs: [] };
  }
  const runs = await Promise.all(
    runsRaw.map(async (r) => {
      const jobs = await fetchWorkflowRunJobs(token, repoFullName, r.id);
      return mapWorkflowRun(r, jobs);
    })
  );
  return { ok: true, runs };
}

function runIsInFlight(run) {
  return WORKFLOW_RUN_IN_FLIGHT_STATUSES.has(run.status);
}

/**
 * Fetch one workflow run by id, mapped like branch-page runs (jobs included unless
 * withJobs is false). Returns null when the request fails or the run does not exist.
 */
async function fetchWorkflowRunById(token, repoFullName, runId, { withJobs = true } = {}) {
  const res = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/actions/runs/${runId}`,
    {
      token,
    }
  );
  if (!res.ok) return null;
  let raw;
  try {
    raw = await res.json();
  } catch {
    return null;
  }
  if (!raw?.id) return null;
  const jobs = withJobs ? await fetchWorkflowRunJobs(token, repoFullName, raw.id) : [];
  return mapWorkflowRun(raw, jobs);
}

function filterWorkflowRuns(runs, { conclusion, status } = {}) {
  let filtered = runs;
  if (status) {
    filtered = filtered.filter((r) => r.status === status);
  }
  if (conclusion) {
    filtered = filtered.filter((r) => r.conclusion === conclusion);
  }
  return filtered;
}

/**
 * Recent workflow runs for a branch (with jobs) plus PR-head check rollup.
 * When waiting, stop reasons are surfaced: `wait_timed_out` (deadline elapsed),
 * `wait_fetch_failed` (last poll fetch failed), `wait_run_not_found` (wait_for_run_id
 * was never observed in any successful poll).
 * @returns {{ runs: Array<object>, checks: Array<object>, head_sha: string | null, checks_source: 'graphql' | 'rest' | null, wait_timed_out?: boolean, wait_fetch_failed?: boolean, wait_run_not_found?: boolean, resolved_pr_number?: number }}
 */
export async function getPRWorkflows(token, repoFullName, branch, options = {}) {
  const {
    prNumber: prNumberOption,
    conclusion,
    status,
    waitForCompletion = false,
    waitForRunId,
    waitTimeoutSeconds = 120,
    perPage = 10,
    pollIntervalMs = 5000,
  } = options;

  let effectivePrNumber = prNumberOption ?? null;
  if (effectivePrNumber == null) {
    const open = await getOpenPR(token, repoFullName, branch);
    effectivePrNumber = open?.number ?? null;
  }

  const shouldWait = Boolean(waitForCompletion || waitForRunId != null);
  const deadline = Date.now() + waitTimeoutSeconds * 1000;
  let waitTimedOut = false;
  let waitFetchFailed = false;
  let targetRunSeen = false;
  let runs = [];

  if (shouldWait) {
    for (;;) {
      let settled = false;
      if (waitForRunId != null) {
        // Poll the target run by id: newer runs can slide it out of the branch
        // page, and a page-only check would silently treat "not found" as done.
        const target = await fetchWorkflowRunById(token, repoFullName, waitForRunId, {
          withJobs: false,
        });
        if (target) {
          targetRunSeen = true;
          waitFetchFailed = false;
          settled = !runIsInFlight(target);
        } else {
          waitFetchFailed = true;
        }
      } else {
        const page = await loadWorkflowRunsForBranch(token, repoFullName, branch, perPage);
        if (page.ok) {
          runs = page.runs;
          waitFetchFailed = false;
          settled = !page.runs.some(runIsInFlight);
        } else {
          // A failed poll is not "everything finished" — keep polling.
          waitFetchFailed = true;
        }
      }
      if (settled) break;
      if (Date.now() >= deadline) {
        waitTimedOut = true;
        break;
      }
      await sleep(pollIntervalMs);
    }

    if (waitForRunId != null) {
      // The polling loop checks the run by id; load the branch page for response data.
      const page = await loadWorkflowRunsForBranch(token, repoFullName, branch, perPage);
      if (page.ok) {
        runs = page.runs;
      } else {
        waitFetchFailed = true;
      }
      // The target run may have slid out of the branch page — fetch it directly so
      // the response still carries its conclusion and jobs.
      if (!runs.some((r) => String(r.id) === String(waitForRunId))) {
        const target = await fetchWorkflowRunById(token, repoFullName, waitForRunId);
        if (target) runs = [target, ...runs];
      }
    }
  } else {
    const page = await loadWorkflowRunsForBranch(token, repoFullName, branch, perPage);
    runs = page.runs;
  }

  runs = filterWorkflowRuns(runs, { conclusion, status });

  const rollupHeadSha = runs[0]?.head_sha ?? undefined;
  const rollup = await fetchPRCheckRollup(token, repoFullName, {
    prNumber: effectivePrNumber ?? undefined,
    headSha: rollupHeadSha,
  });

  const result = {
    runs,
    checks: rollup.checks,
    checks_source: rollup.checks_source ?? null,
    head_sha: rollup.head_sha ?? rollupHeadSha ?? null,
  };
  if (waitTimedOut) result.wait_timed_out = true;
  if (waitFetchFailed) result.wait_fetch_failed = true;
  if (waitForRunId != null && !targetRunSeen) result.wait_run_not_found = true;
  if (effectivePrNumber != null && prNumberOption == null) {
    result.resolved_pr_number = effectivePrNumber;
  }
  return result;
}

function selectWorkflowLogJobs(allJobs, { jobId, jobName, allJobs: fetchAllJobs } = {}) {
  if (jobId != null) {
    const match = allJobs.filter((j) => String(j.id) === String(jobId));
    if (match.length === 0) {
      throw new Error(`No job with id ${jobId} in workflow run`);
    }
    return match;
  }
  if (jobName != null) {
    const match = allJobs.filter((j) => j.name === jobName);
    if (match.length === 0) {
      throw new Error(`No job named ${jobName} in workflow run`);
    }
    return match;
  }
  if (fetchAllJobs) {
    return allJobs;
  }
  const failedJobs = allJobs.filter(
    (j) => j.conclusion === 'failure' || j.conclusion === 'timed_out'
  );
  return failedJobs.length > 0 ? failedJobs : allJobs;
}

/**
 * Fetches logs for failed jobs (or all jobs if none failed) in a workflow run.
 * Supports byte-range pagination: pass startByte/endByte to read specific chunks.
 * By default returns the last DEFAULT_LOG_BYTES bytes (where errors appear).
 *
 * @returns {{ jobs: Array<{ id, name, status, conclusion, log, totalBytes, startByte, endByte }> }}
 */
export async function getPRWorkflowLogs(
  token,
  repoFullName,
  runId,
  { startByte, endByte, jobId, jobName, allJobs: fetchAllJobs } = {}
) {
  const validationError = validateLogByteRange({ startByte, endByte });
  if (validationError) {
    throw new Error(validationError);
  }

  const jobsRes = await githubFetch(
    `https://api.github.com/repos/${repoFullName}/actions/runs/${runId}/jobs?per_page=100`,
    { token }
  );
  if (!jobsRes.ok) {
    throw new Error(`Failed to fetch jobs for run ${runId}: ${jobsRes.status}`);
  }
  const jobsData = await jobsRes.json();
  const allJobs = jobsData.jobs || [];

  const targetJobs = selectWorkflowLogJobs(allJobs, { jobId, jobName, allJobs: fetchAllJobs });

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
    if (baseBranch) patchBody.base = baseBranch;
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
