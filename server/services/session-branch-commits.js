import { resolveDataDirRelativePath } from '../config.js';
import { gitRevParseShort } from './github.js';
import { isGlobalSession } from '../../shared/session-scope.js';

async function loadSession(app, sessionId) {
  return app.get('db')('sessions').where({ id: sessionId }).first();
}

function patchUser(session) {
  return { provider: undefined, user: { id: session.user_id } };
}

/** After a successful review turn: mark current HEAD (short sha) as last reviewed. */
export async function markSessionReviewedAtHead(app, sessionId) {
  const session = await loadSession(app, sessionId);
  if (!session || isGlobalSession(session) || !session.worktree_path) return;
  const cwd = resolveDataDirRelativePath(session.worktree_path);
  const head = await gitRevParseShort(cwd, 'HEAD');
  if (!head) return;
  await app
    .service('sessions')
    .patch(session.id, { last_reviewed_commit_sha: head }, patchUser(session));
}
