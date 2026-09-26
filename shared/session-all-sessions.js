import { isGlobalSession } from './session-scope.js';

/** Whether a session should appear on the All sessions dashboard / sidebar. */
export function isSessionShownInAllSessionsView(session, repos) {
  if (!session || isGlobalSession(session)) return true;
  const repoId = session.repo_id;
  const repo = repos?.find(
    (r) =>
      (repoId != null && String(r.id) === String(repoId)) || r.full_name === session.repo_full_name
  );
  if (!repo) return true;
  return repo.show_in_all_sessions !== false && repo.show_in_all_sessions !== 0;
}
