/**
 * Rewrite paths after Docker DATA_DIR moved to /data/baguette.
 * Legacy layouts:
 * - HOME=/home/baguette → /home/baguette/.baguette/...
 * - DATA_DIR=/data/.baguette
 *
 * - repos.bare_path in SQLite
 * - session worktree pointer files: repos/<repo>/sessions/<id>/worktree/.git
 * - bare-repo worktree metadata: repos/<repo>/main/.git/worktrees/<name>/gitdir
 */

import fs from 'fs/promises';
import path from 'path';
import { DATA_DIR } from '../config.js';

const OLD_PREFIXES = ['/home/baguette/.baguette', '/data/.baguette'];
const NEW_PREFIX = '/data/baguette';

async function rewriteFilePrefix(filePath, fromPrefix, toPrefix) {
  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    return;
  }
  if (!content.includes(fromPrefix)) return;
  await fs.writeFile(filePath, content.replaceAll(fromPrefix, toPrefix), 'utf8');
}

/** @param {string} reposDir Absolute path to <DATA_DIR>/repos */
export async function rewriteWorktreeGitDirFiles(reposDir, fromPrefix, toPrefix) {
  let repoNames;
  try {
    repoNames = await fs.readdir(reposDir);
  } catch {
    return;
  }

  for (const strippedName of repoNames) {
    const repoRoot = path.join(reposDir, strippedName);
    const sessionsDir = path.join(repoRoot, 'sessions');
    try {
      const sessionIds = await fs.readdir(sessionsDir);
      for (const sessionId of sessionIds) {
        const gitFile = path.join(sessionsDir, sessionId, 'worktree', '.git');
        await rewriteFilePrefix(gitFile, fromPrefix, toPrefix);
      }
    } catch {
      /* no sessions dir */
    }

    const worktreesAdmin = path.join(repoRoot, 'main', '.git', 'worktrees');
    try {
      const worktreeNames = await fs.readdir(worktreesAdmin);
      for (const wtName of worktreeNames) {
        const gitdirFile = path.join(worktreesAdmin, wtName, 'gitdir');
        await rewriteFilePrefix(gitdirFile, fromPrefix, toPrefix);
      }
    } catch {
      /* no worktrees */
    }
  }
}

async function rewriteStoredPaths(knex, fromPrefix, toPrefix) {
  await knex.raw(`UPDATE repos SET bare_path = REPLACE(bare_path, ?, ?) WHERE bare_path LIKE ?`, [
    fromPrefix,
    toPrefix,
    `${fromPrefix}%`,
  ]);
  await rewriteWorktreeGitDirFiles(path.join(DATA_DIR, 'repos'), fromPrefix, toPrefix);
}

export async function up(knex) {
  for (const oldPrefix of OLD_PREFIXES) {
    await rewriteStoredPaths(knex, oldPrefix, NEW_PREFIX);
  }
}

export async function down(knex) {
  // Cannot tell which legacy prefix a row used; down restores the older home layout only.
  const [primaryOldPrefix] = OLD_PREFIXES;
  await rewriteStoredPaths(knex, NEW_PREFIX, primaryOldPrefix);
}
