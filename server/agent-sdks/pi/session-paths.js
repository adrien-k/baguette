import path from 'node:path';
import { resolveDataDirRelativePath } from '../../config.js';
import { cursorSessionDataDir } from '../cursor/session-paths.js';
import { agentWorktreeCwd } from '../../services/subagent-worktree.js';

function piSessionDataDir(session) {
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

export function piWorktreeCwd(session, agent = null) {
  return (
    agentWorktreeCwd(session, agent) ||
    resolveDataDirRelativePath(session?.session_path) ||
    process.cwd()
  );
}
