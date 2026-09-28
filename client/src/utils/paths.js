/**
 * Replace absolute worktree paths in arbitrary text (e.g. shell commands) with "." / "./".
 */
export function stripWorktreeFromText(text, worktreePath) {
  if (!text || !worktreePath) return text;
  const root = worktreePath.endsWith('/') ? worktreePath.slice(0, -1) : worktreePath;
  let out = text.split(`${root}/`).join('./');
  out = out.split(root).join('.');
  return out;
}

/**
 * Remove a leading `cd <absolute worktree> &&` from a shell command (card summary only).
 */
export function stripCdWorktreePrefix(command, worktreePath) {
  if (!command || !worktreePath) return command;
  const root = worktreePath.endsWith('/') ? worktreePath.slice(0, -1) : worktreePath;
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*cd\\s+(?:${escaped}|['"]${escaped}['"])\\s*&&\\s*`);
  return command.replace(re, '');
}

/**
 * Strip the worktree path prefix from a file path, replacing it with "./".
 */
export function stripWorktreePath(filePath, worktreePath) {
  if (!filePath || !worktreePath) return filePath;
  const root = worktreePath.endsWith('/') ? worktreePath.slice(0, -1) : worktreePath;
  if (filePath === root || filePath.startsWith(`${root}/`)) {
    return stripWorktreeFromText(filePath, worktreePath);
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

/** Path to show/scroll for a changed-file record from parseDiff or `changedFiles`. */
export function diffFileDisplayPath(file) {
  const newPath = file?.newPath ?? file?.new_path;
  const oldPath = file?.oldPath ?? file?.old_path;
  return newPath && newPath !== '/dev/null' ? newPath : oldPath || '';
}

export function diffFileScrollId(fileOrPath) {
  const path = typeof fileOrPath === 'string' ? fileOrPath : diffFileDisplayPath(fileOrPath);
  return `diff-file-${path}`;
}
