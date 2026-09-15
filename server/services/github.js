import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { REPOS_DIR, resolveDataDirRelativePath } from '../config.js';
import * as cache from '../lib/cache.js';

const execFileAsync = promisify(execFile);

export function gitAuthArgs(token) {
  const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.https://github.com/.extraheader=Authorization: Basic ${encoded}`];
}

function sanitizeGitError(token, err) {
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

function cacheKeyForToken(token) {
  if (!token) return 'anonymous';
  return crypto.createHash('sha256').update(token).digest('hex');
}

function repoHash(repoFullName) {
  return crypto.createHash('sha256').update(repoFullName).digest('hex');
}

/**
 * Generic paginated GitHub API fetch.
 * @param {string} url    Base URL (without page param)
 * @param {string} token  GitHub token
 * @param {(item: object) => T} mapFn  Transform each response item
 * @returns {Promise<T[]>}
 */
async function fetchAllPages(url, token, mapFn) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' };
  const results = [];
  const separator = url.includes('?') ? '&' : '?';
  let page = 1;
  while (true) {
    const res = await fetch(`${url}${separator}per_page=100&page=${page}`, { headers });
    if (!res.ok) break;
    const data = await res.json();
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

// Refreshing org and repo lists is manual, so we can cache them indefinitely
const REPOS_CACHE_TTL = Infinity;
/** Repos for the "Personal" picker: owned by the user and direct collaborator access (incl. other users' private repos). */
export function listUserRepos(token) {
  return cache.fetch(
    `github-repos-${cacheKeyForToken(token)}-personal-owner-collab`,
    REPOS_CACHE_TTL,
    () =>
      fetchAllPages(
        'https://api.github.com/user/repos?sort=updated&affiliation=owner,collaborator',
        token,
        mapRepo
      )
  );
}

export function listUserOrgs(token) {
  return cache.fetch(`github-orgs-${cacheKeyForToken(token)}`, REPOS_CACHE_TTL, () =>
    fetchAllPages('https://api.github.com/user/orgs', token, (o) => ({
      login: o.login,
      avatar_url: o.avatar_url,
    }))
  );
}

export function listOrgRepos(token, orgLogin) {
  return cache.fetch(
    `github-repos-${cacheKeyForToken(token)}-org-${orgLogin}`,
    REPOS_CACHE_TTL,
    () =>
      fetchAllPages(
        `https://api.github.com/orgs/${orgLogin}/repos?sort=updated&type=all`,
        token,
        mapRepo
      )
  );
}

const BRANCHES_CACHE_TTL = 60;
export function listBranches(token, repoFullName) {
  return cache.fetch(
    `github-branches-${cacheKeyForToken(token)}-${repoHash(repoFullName)}`,
    BRANCHES_CACHE_TTL,
    () =>
      fetchAllPages(`https://api.github.com/repos/${repoFullName}/branches`, token, (b) => b.name)
  );
}

export function clearReposCache(token) {
  return cache.clearByPrefix(`github-repos-${cacheKeyForToken(token)}-`);
}

export function clearOrgsCache(token) {
  return cache.clearByPrefix(`github-orgs-${cacheKeyForToken(token)}`);
}

export function clearBranchesCache(token) {
  return cache.clearByPrefix(`github-branches-${cacheKeyForToken(token)}-`);
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
    } catch { /* repo may not use LFS */ }
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

/** @param {{ baseBranch?: string, detach?: boolean }} [opts] — `detach` defaults to true (false checks out `branch` in the new worktree). */
export async function createWorktree(repo, branch, worktreeId, token, opts = {}) {
  const { baseBranch, detach = true } = opts;
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
    const msg = err?.stderr?.toString() ?? err?.message ?? '';
    const isNoRemote = msg.includes("No such remote") || msg.includes("does not appear to be a git repository");
    if (!isNoRemote) throw err;
    // Local repo with no origin — use existing local branch ref as-is
  }
  // Sync the local branch ref to the fetched commit so new worktrees start from the latest
  // remote commit rather than the stale commit from when the bare clone was created.
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', tempRef], { cwd: barePath, stdio: 'pipe' });
    await execFileAsync('git', ['update-ref', `refs/heads/${branch}`, stdout.trim()], { cwd: barePath, stdio: 'pipe' });
  } catch { /* fall back to existing local ref */ }
  // Clean up temp ref (best-effort)
  try { await execFileAsync('git', ['update-ref', '-d', tempRef], { cwd: barePath, stdio: 'pipe' }); } catch { /* ignore */ }

  // Also fetch the base branch so origin/<baseBranch> is up to date for merge-base diffs
  if (baseBranch && baseBranch !== branch) {
    try {
      await gitWithToken(
        token,
        ['fetch', 'origin', `+${baseBranch}:refs/remotes/origin/${baseBranch}`],
        { cwd: barePath, stdio: 'pipe' }
      );
    } catch { /* local repo with no remote — skip */ }
  }

  if (await lfsAvailable()) {
    try {
      await gitWithToken(token, ['lfs', 'fetch', 'origin', branch], { cwd: barePath, stdio: 'pipe' });
    } catch { /* repo may not use LFS */ }
  }

  try {
    await fs.promises.access(worktreePath);
  } catch {
    const addArgs = detach
      ? ['worktree', 'add', '--detach', worktreePath, branch]
      : ['worktree', 'add', worktreePath, branch];
    await execFileAsync('git', addArgs, {
      cwd: barePath,
      stdio: 'pipe',
    });
  }

  if (await lfsAvailable()) {
    try {
      await execFileAsync('git', ['lfs', 'checkout'], { cwd: worktreePath, stdio: 'pipe' });
    } catch { /* ignore */ }
  }

  return { worktreePath };
}

/**
 * Configure git user identity in a worktree's local git config so commits carry
 * the correct author regardless of which agent (Claude or Cursor) runs them.
 */
export async function configureWorktreeGitIdentity(worktreePath, user) {
  const name = user?.username || 'baguette';
  const email =
    user?.email ||
    (user?.github_id && user?.username
      ? `${user.github_id}+${user.username}@users.noreply.github.com`
      : 'baguette@users.noreply.github.com');
  await execFileAsync('git', ['-C', worktreePath, 'config', 'user.name', name], { stdio: 'pipe' });
  await execFileAsync('git', ['-C', worktreePath, 'config', 'user.email', email], { stdio: 'pipe' });
}

export async function removeWorktree(session, repo) {
  const absoluteWorktreePath = resolveDataDirRelativePath(session?.worktree_path);
  if (!absoluteWorktreePath) return;
  try {
    await fs.promises.access(absoluteWorktreePath);
  } catch {
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
      return;
    } catch {
      /* fall through to rm below */
    }
  }
  await fs.promises.rm(cleanupPath, { recursive: true, force: true });
}

/**
 * Returns the first open PR whose head is `owner:branch` for this repo, or null.
 * @returns {Promise<null | { number: number, html_url: string, title: string, base_ref: string, draft: boolean }>}
 */
export async function getOpenPR(token, repoFullName, branch) {
  if (!token) return null;
  const [owner] = repoFullName.split('/');
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open&per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'baguette-app',
      },
    }
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
    } catch { /* repo may not use LFS */ }
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
export async function gitPush(worktreePath, token, { branch, force = false, forceOverwrite = false } = {}) {
  const targetBranch = branch ?? (
    await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath })
  ).stdout.trim();

  const pushArgs = ['push', '--set-upstream'];
  if (forceOverwrite) pushArgs.push('--force');
  else if (force) pushArgs.push('--force-with-lease');
  pushArgs.push('origin', targetBranch);

  try {
    await gitWithToken(token, pushArgs, {
      cwd: worktreePath,
      stdio: 'pipe',
    });
  } catch (pushErr) {
    const stderr = pushErr.stderr?.toString() ?? '';
    if (stderr.includes('[rejected]') || stderr.includes('Updates were rejected')) {
      const guidance = force || forceOverwrite
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
 * Returns the number of local commits not yet pushed to any remote.
 * @returns {Promise<number>}
 */
export async function gitCommitsToPush(worktreePath) {
  try {
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
    remoteSha: remoteResult.status === 'fulfilled' ? remoteResult.value.stdout.trim() || null : null,
  };
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
    // Prefer origin/<baseBranch> for accurate merge-base; fall back to local branch ref
    // for local repos that have no remote or where origin hasn't been fetched.
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
    const args = ['-C', worktreePath, 'diff', mergeBase.trim()];
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
 * Fetches the current status of a pull request.
 * @returns {'open' | 'draft' | 'closed' | 'merged'}
 */
export async function getPRStatus(token, repoFullName, prNumber) {
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'baguette-app',
    },
  });
  if (!res.ok) throw new Error('Failed to fetch PR status');
  const data = await res.json();
  if (data.merged) return 'merged';
  if (data.state === 'closed') return 'closed';
  if (data.draft) return 'draft';
  return 'open';
}

/**
 * Converts a draft PR to ready for review via the GitHub GraphQL API.
 */
export async function markPRReady(token, repoFullName, prNumber) {
  // First fetch the PR node ID required by GraphQL
  const prRes = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'baguette-app',
    },
  });
  if (!prRes.ok) throw new Error('Failed to fetch PR node ID');
  const { node_id } = await prRes.json();

  const gqlRes = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'baguette-app',
    },
    body: JSON.stringify({
      query: `mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }`,
      variables: { id: node_id },
    }),
  });
  if (!gqlRes.ok) throw new Error('Failed to mark PR as ready for review');
  const gqlData = await gqlRes.json();
  if (gqlData.errors?.length) throw new Error(gqlData.errors[0].message);
}

/**
 * Squash-merges a pull request via the GitHub API.
 */
export async function mergePR(token, repoFullName, prNumber) {
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'baguette-app',
    },
    body: JSON.stringify({ merge_method: 'squash' }),
  });
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
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'baguette-app',
    },
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
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'baguette-app',
  };
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
    fetch(`https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments?per_page=100`, {
      headers,
    }),
    fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/comments?per_page=100`, {
      headers,
    }),
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
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'User-Agent': 'baguette-app',
    },
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
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'baguette-app',
      },
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
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'baguette-app',
      },
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
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/reviews`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'baguette-app',
      },
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

/**
 * Lists recent workflow runs for a branch.
 * @returns {Array<{ id, name, status, conclusion, html_url, created_at }>}
 */
export async function getPRWorkflows(token, repoFullName, branch) {
  const url = `https://api.github.com/repos/${repoFullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=10`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'baguette-app',
    },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.workflow_runs || []).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    html_url: r.html_url,
    created_at: r.created_at,
  }));
}

const DEFAULT_LOG_BYTES = 8000;

/**
 * Fetches logs for failed jobs (or all jobs if none failed) in a workflow run.
 * Supports byte-range pagination: pass startByte/endByte to read specific chunks.
 * By default returns the last DEFAULT_LOG_BYTES bytes (where errors appear).
 *
 * @returns {{ jobs: Array<{ id, name, status, conclusion, log, totalBytes, startByte, endByte }> }}
 */
export async function getPRWorkflowLogs(token, repoFullName, runId, { startByte, endByte } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'baguette-app',
  };

  // Get jobs list for this run
  const jobsRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/actions/runs/${runId}/jobs?per_page=30`,
    { headers }
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
      const logRes = await fetch(
        `https://api.github.com/repos/${repoFullName}/actions/jobs/${job.id}/logs`,
        { headers, redirect: 'manual' }
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

      // Step 2: build Range header
      let rangeHeader;
      if (startByte != null && endByte != null) {
        rangeHeader = `bytes=${startByte}-${endByte}`;
      } else if (startByte != null) {
        rangeHeader = `bytes=${startByte}-`;
      } else {
        rangeHeader = `bytes=-${DEFAULT_LOG_BYTES}`;
      }

      // Step 3: fetch log with range
      const rangeRes = await fetch(logUrl, { headers: { Range: rangeHeader } });
      const log = await rangeRes.text();

      // Parse Content-Range: bytes start-end/total
      let totalBytes = 0;
      let actualStart = startByte ?? 0;
      let actualEnd = endByte ?? DEFAULT_LOG_BYTES;
      const contentRange = rangeRes.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
        if (match) {
          actualStart = parseInt(match[1], 10);
          actualEnd = parseInt(match[2], 10);
          totalBytes = parseInt(match[3], 10);
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
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'baguette-app',
  };

  if (prNumber) {
    const patchBody = { title, body };
    if (reopen) patchBody.state = 'open';
    const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patchBody),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub PATCH failed: ${text}`);
    }
    const data = await res.json();
    return { url: data.html_url, number: data.number };
  }

  const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, body, head, base: baseBranch, draft: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub POST failed: ${text}`);
  }
  const data = await res.json();
  return { url: data.html_url, number: data.number };
}

const GH_HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'baguette-app',
});

export async function listRepoPRs(token, repoFullName, { state = 'open', author, label, base, text } = {}) {
  const headers = GH_HEADERS(token);

  if (author || label || text) {
    const parts = ['is:pr', `repo:${repoFullName}`, `is:${state}`];
    if (author) parts.push(`author:${author}`);
    if (label) parts.push(`label:${label}`);
    if (text) parts.push(text);
    const q = encodeURIComponent(parts.join(' '));
    const res = await fetch(
      `https://api.github.com/search/issues?q=${q}&per_page=30&sort=updated`,
      { headers }
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
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls?${params}`,
    { headers }
  );
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
  const headers = GH_HEADERS(token);
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/labels`,
    { method: 'POST', headers, body: JSON.stringify({ labels }) }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${await res.text()}`);
  const data = await res.json();
  return data.map((l) => l.name);
}

export async function listRepoTags(token, repoFullName) {
  const headers = GH_HEADERS(token);
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/tags?per_page=50`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${await res.text()}`);
  const tags = await res.json();
  return tags.map((t) => ({ name: t.name, sha: t.commit?.sha }));
}

export const BAGUETTE_DESCRIPTION_MARKER = '<!-- baguette -->';

export function splitPrBody(body) {
  const idx = (body ?? '').indexOf(BAGUETTE_DESCRIPTION_MARKER);
  if (idx < 0) return { userPrefix: '', baguetteContent: body ?? '' };
  const userPrefix = body.slice(0, idx).trimEnd();
  const afterMarker = body.slice(idx + BAGUETTE_DESCRIPTION_MARKER.length).trimStart();
  const baguetteContent = afterMarker.replace(/^---\n+/, '');
  return { userPrefix, baguetteContent };
}

export function buildSessionFooter(session, existingPrBody = '') {
  const parts = [];
  if (session?.agent_sdk) parts.push(`harness: ${session.agent_sdk}`);
  if (session?.model) parts.push(`Model: \`${session.model}\``);
  if (session?.model_params) {
    try {
      const params = JSON.parse(session.model_params);
      if (Array.isArray(params) && params.length) {
        parts.push(`Params: \`${params.map((p) => `${p.id}=${p.value}`).join(', ')}\``);
      }
    } catch {
      // invalid JSON — skip
    }
  }
  if (!parts.length) return '';

  const newCombo = parts.join(' · ');
  const existingCombos = [];
  const footerMatch = (existingPrBody ?? '').match(/\n\n---\n_([\s\S]*?)_\s*$/);
  if (footerMatch) {
    existingCombos.push(...footerMatch[1].split('\n').filter(Boolean));
  }
  if (!existingCombos.includes(newCombo)) {
    existingCombos.push(newCombo);
  }
  return `\n\n---\n_${existingCombos.join('\n')}_`;
}

export function buildPrBody(userPrefix, baguetteContent, footer = '') {
  const baguetteSection = `${BAGUETTE_DESCRIPTION_MARKER}\n---\n\n${baguetteContent}${footer}`;
  return userPrefix ? `${userPrefix}\n\n${baguetteSection}` : baguetteSection;
}
