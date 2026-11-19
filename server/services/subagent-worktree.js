import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { BadRequest } from 'feathers/errors';
import { DATA_DIR, resolveDataDirRelativePath, resolveRepoPath } from '../config.js';
import {
  createSubagentGitWorktree,
  removeSubagentGitWorktree,
  deleteLocalGitBranchBestEffort,
  resolveSessionWorktreePath,
} from './github.js';
import { isGlobalSession } from '../../shared/session-scope.js';
import { isTaskStoppable } from '../../shared/task-status.js';
import logger from '../logger.js';

const execFileAsync = promisify(execFile);

export function subagentLocalBranchName(agentId) {
  return `baguette/subagent/${agentId}`;
}

/** Absolute on-disk path for an isolated subagent worktree (sibling of the session worktree). */
export function subagentWorktreeAbsolutePath(session, repo, agentId) {
  const sessionWorktree = resolveSessionWorktreePath(session, repo);
  if (!sessionWorktree) return null;
  const sessionDir = path.dirname(sessionWorktree);
  return path.join(sessionDir, 'sub-worktrees', String(agentId));
}

export function worktreePathForStorage(absoluteWorktreePath) {
  const rel = path.relative(DATA_DIR, absoluteWorktreePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Subagent worktree path is outside DATA_DIR');
  }
  return rel.split(path.sep).join('/');
}

export function assertIsolatedWorktreeAllowed(session) {
  if (isGlobalSession(session)) {
    throw new BadRequest('isolated_worktree is not supported for global sessions');
  }
  if (!session?.session_path && !session?.short_id) {
    throw new BadRequest('isolated_worktree requires a session with a git worktree');
  }
}

/** Absolute cwd for an agent turn or task: isolated worktree when set, else the session worktree. */
export function agentWorktreeCwd(session, agent) {
  if (agent?.worktree_path) {
    const isolated = resolveDataDirRelativePath(agent.worktree_path);
    if (isolated) return isolated;
  }
  return resolveDataDirRelativePath(session?.session_path) || null;
}

export function subagentWorktreePayload(agent) {
  const isolated = Boolean(agent?.worktree_path);
  let worktreePath = null;
  if (isolated) {
    worktreePath = resolveDataDirRelativePath(agent.worktree_path) || null;
  }
  return {
    isolated_worktree: isolated,
    worktree_path: worktreePath,
    local_branch: isolated ? (agent.local_branch ?? null) : null,
  };
}

async function sessionWorktreeHeadSha(sessionWorktreePath) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: sessionWorktreePath,
    stdio: 'pipe',
  });
  return stdout.trim();
}

/**
 * Create an isolated git worktree for a subagent. Does not touch the database.
 * @returns {{ worktree_path: string, local_branch: string, worktree_path_stored: string }}
 */
export async function provisionIsolatedSubagentWorktree(session, repo, agentId) {
  assertIsolatedWorktreeAllowed(session);
  const mainRepoPath = resolveRepoPath(repo);
  if (!mainRepoPath) {
    throw new BadRequest('Repository has no main clone for worktree operations');
  }
  const sessionWorktree = resolveSessionWorktreePath(session, repo);
  if (!sessionWorktree) {
    throw new BadRequest('Session worktree is not available');
  }
  try {
    await fs.promises.access(sessionWorktree);
  } catch {
    throw new BadRequest('Session worktree is not available');
  }

  const localBranch = subagentLocalBranchName(agentId);
  const absoluteWorktreePath = subagentWorktreeAbsolutePath(session, repo, agentId);
  await fs.promises.mkdir(path.dirname(absoluteWorktreePath), { recursive: true });

  const headSha = await sessionWorktreeHeadSha(sessionWorktree);
  await createSubagentGitWorktree(mainRepoPath, localBranch, absoluteWorktreePath, headSha);

  return {
    worktree_path: absoluteWorktreePath,
    local_branch: localBranch,
    worktree_path_stored: worktreePathForStorage(absoluteWorktreePath),
  };
}

/** Remove worktree registration and delete the throwaway branch (best-effort). */
export async function teardownIsolatedSubagentWorktree(repo, agentRow) {
  if (!agentRow?.worktree_path) return;
  const mainRepoPath = resolveRepoPath(repo);
  const absoluteWorktreePath = resolveDataDirRelativePath(agentRow.worktree_path);
  if (mainRepoPath && absoluteWorktreePath) {
    await removeSubagentGitWorktree(mainRepoPath, absoluteWorktreePath);
    if (agentRow.local_branch) {
      await deleteLocalGitBranchBestEffort(mainRepoPath, agentRow.local_branch);
    }
  }
  if (absoluteWorktreePath) {
    try {
      await fs.promises.rm(absoluteWorktreePath, { recursive: true, force: true });
    } catch (err) {
      logger.warn(
        { err: err?.message, worktreePath: absoluteWorktreePath },
        'Failed to rm subagent worktree directory after remove'
      );
    }
  }
  const parentDir = absoluteWorktreePath ? path.dirname(absoluteWorktreePath) : null;
  if (parentDir && path.basename(parentDir) === 'sub-worktrees') {
    try {
      const entries = await fs.promises.readdir(parentDir);
      if (entries.length === 0) {
        await fs.promises.rm(parentDir, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Kill running tasks whose cwd is under a subagent worktree, then remove each sub-worktree.
 * Task listing does not expose cwd publicly — we match via the in-memory Task store.
 */
export async function killTasksUnderSubagentWorktrees(app, sessionId, agentRows) {
  const tasksSvc = app.service('tasks');
  const prefixes = agentRows
    .map((row) => resolveDataDirRelativePath(row.worktree_path))
    .filter(Boolean)
    .map((p) => path.resolve(p) + path.sep);

  if (!prefixes.length) return;

  const store = tasksSvc._tasks;
  if (!store || typeof store.values !== 'function') {
    return;
  }

  const toKill = [];
  for (const task of store.values()) {
    if (task.session_id !== sessionId || !isTaskStoppable(task.status)) continue;
    const cwd = task._cwd ? path.resolve(task._cwd) + path.sep : '';
    const underSub = prefixes.some((prefix) => cwd.startsWith(prefix));
    if (underSub) {
      toKill.push(task);
    }
  }

  await Promise.all(toKill.map((t) => t.kill().catch(() => {})));
}

/** Remove all isolated subagent worktrees for a session before the session worktree is torn down. */
export async function teardownSubagentWorktreesForSessionArchive(app, sessionId, session, repo) {
  if (isGlobalSession(session)) return;
  const db = app.get('db');
  const agents = await db('agents')
    .where({ session_id: sessionId })
    .whereNotNull('worktree_path')
    .select('id', 'worktree_path', 'local_branch');
  if (!agents.length) return;

  await killTasksUnderSubagentWorktrees(app, sessionId, agents);
  for (const agent of agents) {
    await teardownIsolatedSubagentWorktree(repo, agent);
  }
}
