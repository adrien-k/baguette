import { isGlobalSession } from '../../shared/session-scope.js';
import { resolveDataDirRelativePath } from '../config.js';
import { compactOversizedToolCallMessages } from './mcp/lib/compact-oversized-tool-messages.js';

/** @type {Map<number, () => Promise<void>>} */
const baguetteToolMessageCompactionHooks = new Map();

/**
 * Pi's `context` spill transform runs on Pi-native history; register a hook so it
 * can backfill Baguette `session_messages` tool_call rows when legacy rows spill.
 * Hooks are keyed by Baguette `session.id` so concurrent Pi turns do not cross-compact.
 *
 * @param {number} sessionId
 * @param {() => Promise<void>} fn
 */
export function registerBaguetteToolMessageCompactionHook(sessionId, fn) {
  if (!Number.isFinite(sessionId)) return;
  baguetteToolMessageCompactionHooks.set(sessionId, fn);
}

/**
 * @param {number} sessionId
 */
export function unregisterBaguetteToolMessageCompactionHook(sessionId) {
  if (!Number.isFinite(sessionId)) return;
  baguetteToolMessageCompactionHooks.delete(sessionId);
}

/**
 * @param {number} [sessionId]
 * @returns {(() => Promise<void>) | null}
 */
export function getBaguetteToolMessageCompactionHook(sessionId) {
  if (!Number.isFinite(sessionId)) return null;
  return baguetteToolMessageCompactionHooks.get(sessionId) ?? null;
}

/**
 * Rewrite oversized tool_call payloads in `session_messages` before an agent turn.
 *
 * @param {object} app Feathers application
 * @param {{ id: number, user_id: number, session_path?: string | null }} session
 */
export async function prepareAgentTurnCompaction(app, session) {
  if (!session?.session_path || isGlobalSession(session)) return;
  const sessionPath = resolveDataDirRelativePath(session.session_path) || session.session_path;
  await compactOversizedToolCallMessages(app, {
    sessionId: session.id,
    userId: session.user_id,
    sessionPath,
  });
}
