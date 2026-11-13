export const LIST_SCOPE_MINE = 'mine';
export const LIST_SCOPE_SHARED = 'shared';
/** Owned plus others’ shared items (MCP SearchSessions / ListLoops). */
export const LIST_SCOPE_ALL = 'all';

export function normalizeListScope(value) {
  if (value === LIST_SCOPE_SHARED || value === true || value === 1 || value === '1') {
    return LIST_SCOPE_SHARED;
  }
  if (value === LIST_SCOPE_ALL || value === 'accessible') {
    return LIST_SCOPE_ALL;
  }
  return LIST_SCOPE_MINE;
}

export function isSessionOwner(session, user) {
  const userId = user?.id ?? user;
  if (session == null || userId == null) return false;
  return String(session.user_id) === String(userId);
}

export function ownerPublicFields(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    avatar_url: user.avatar_url ?? null,
  };
}
