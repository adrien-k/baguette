import { fail } from './result.js';
import { requireOwnedSessionById } from './session-resolution.js';

export async function requireMcpSession(app, session_id, userId) {
  const { session, error } = await requireOwnedSessionById(app, session_id, userId);
  if (!session) return { session: null, result: fail(error ?? 'Session not found') };
  return { session, result: null };
}
