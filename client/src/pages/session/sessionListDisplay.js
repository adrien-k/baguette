import { isGlobalSession } from '@baguette/shared/session-scope.js';

export function sessionListPromptPreview(s, maxWords = 12) {
  const prompt = s.initial_prompt?.trim();
  if (!prompt) return null;
  const parts = prompt.split(/\s+/);
  if (parts.length <= maxWords) return prompt;
  return `${parts.slice(0, maxWords).join(' ')}…`;
}

export function sessionHeaderTitle(session, isMdUp) {
  if (session?.label) return session.label;
  if (isGlobalSession(session)) return 'Global session';
  if (isMdUp && session?.repo_full_name) return session.repo_full_name;
  return 'Session';
}

export function nextVisibleSession({ sessions, sessionId, session, repoId, fromAllSessions }) {
  return sessions.find((s) => {
    if (
      String(s.id) === String(sessionId) ||
      s.archived_at ||
      s.status === 'archiving' ||
      s.status === 'archived'
    )
      return false;
    if (fromAllSessions) return true;
    if (isGlobalSession(session)) return isGlobalSession(s);
    const currentRepoId = repoId || session?.repo_id;
    return !currentRepoId || String(s.repo_id) === String(currentRepoId);
  });
}
