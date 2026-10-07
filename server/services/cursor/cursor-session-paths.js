import path from 'node:path';
import { DATA_DIR, REPOS_DIR, resolveDataDirRelativePath } from '../../config.js';
import { toStrippedName } from '../github.js';

/**
 * On-disk session folder (`.../sessions/<short_id>/`), sibling to `worktree` and `cursor-dir`.
 */
export function cursorSessionDataDir(session) {
  const fromDb = resolveDataDirRelativePath(session?.session_path);
  if (fromDb) {
    if (path.basename(fromDb) === 'worktree') return path.dirname(fromDb);
    return path.join(path.dirname(fromDb), 'session-data');
  }
  const repoFullName = session?.repo_full_name;
  const shortId = session?.short_id;
  if (repoFullName && shortId) {
    return path.join(REPOS_DIR, toStrippedName(repoFullName), 'sessions', shortId);
  }
  return null;
}

/** Per-session SQLite agent store (replaces the global `DATA_DIR/cursor-sdk-store` when set). */
export function cursorSdkStateRoot(session) {
  const dataDir = cursorSessionDataDir(session);
  return dataDir ? path.join(dataDir, 'cursor-sdk-store') : null;
}

/** Workspace path used to scope {@link SqliteLocalAgentStore} for a session. */
export function cursorWorkspaceRef(session) {
  const cwd = resolveDataDirRelativePath(session?.session_path);
  if (cwd) return cwd;
  const sessionDir = cursorSessionDataDir(session);
  if (sessionDir) return path.join(sessionDir, 'worktree');
  return DATA_DIR;
}
