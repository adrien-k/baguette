import path from 'node:path';
import { resolveDataDirRelativePath } from '../../config.js';
import { cursorSessionDataDir } from '../cursor/cursor-session-paths.js';

export function piSessionDataDir(session) {
  const base = cursorSessionDataDir(session);
  return base ? path.join(base, 'pi-agent') : null;
}

export function piAgentDir(session) {
  const dataDir = piSessionDataDir(session);
  return dataDir ? path.join(dataDir, 'config') : null;
}

export function piSessionsDir(session) {
  const dataDir = piSessionDataDir(session);
  return dataDir ? path.join(dataDir, 'sessions') : null;
}

export function piWorktreeCwd(session) {
  return resolveDataDirRelativePath(session?.worktree_path) || process.cwd();
}
