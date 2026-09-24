/**
 * Strip the worktree path prefix from a file path, replacing it with "./".
 */
export function stripWorktreePath(filePath, worktreePath) {
  if (!filePath || !worktreePath) return filePath;
  if (filePath.startsWith(worktreePath)) {
    return '.' + filePath.slice(worktreePath.length);
  }
  return filePath;
}

/** Split a repo-relative path into directory and basename for compact file lists. */
export function splitRepoPath(filePath) {
  if (!filePath) return { basename: '?', dirname: '' };
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) return { basename: filePath, dirname: '' };
  return {
    basename: filePath.slice(lastSlash + 1),
    dirname: filePath.slice(0, lastSlash),
  };
}
