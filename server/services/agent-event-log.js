import { appendFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { DATA_DIR, resolveDataDirRelativePath } from '../config.js';

/**
 * @param {{ sessionId: number; worktreePath?: string | null; channel: 'chat' | 'review'; turnId: number }} opts
 */
export function agentEventLogPath({ sessionId, worktreePath, channel, turnId }) {
  const absolute = worktreePath ? resolveDataDirRelativePath(worktreePath) : null;
  const sessionDir =
    absolute && basename(absolute) === 'worktree'
      ? dirname(absolute)
      : absolute
        ? absolute
        : join(DATA_DIR, 'agent-events', String(sessionId));
  return join(sessionDir, 'agent-events', `${channel}-${turnId}.jsonl`);
}

/**
 * @param {string} filePath
 * @param {unknown} event
 */
export async function appendAgentEvent(filePath, event) {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(
    filePath,
    `${JSON.stringify({ at: new Date().toISOString(), event })}\n`,
    'utf8'
  );
}
