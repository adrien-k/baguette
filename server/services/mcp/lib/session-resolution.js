export const SESSION_LIST_COLUMNS = [
  'id',
  'label',
  'status',
  'repo_id',
  'repo_full_name',
  'is_global',
  'base_branch',
  'local_branch',
  'remote_branch',
  'loop_id',
  'pr_url',
  'pr_number',
  'created_at',
  'updated_at',
  'last_activity_at',
  'last_viewed_at',
  'archived_at',
];

async function requireSession(app, sessionId, userId) {
  try {
    const session = await app.service('sessions').get(sessionId, { user: { id: userId } });
    // `short_id` is internal (branch/worktree naming only) — never exposed to agents.
    if (!session) return null;
    const { short_id: _shortId, ...rest } = session;
    return rest;
  } catch {
    return null;
  }
}

export async function resolveOwnedSession(app, { session_id }, userId) {
  if (session_id == null) return null;
  return requireSession(app, session_id, userId);
}

export async function resolveTargetSession(app, session_id, userId, callerSession) {
  if (session_id != null) {
    return requireSession(app, session_id, userId);
  }
  if (callerSession?.id != null) {
    return requireSession(app, callerSession.id, userId);
  }
  return null;
}

export async function requireOwnedSessionById(app, session_id, userId) {
  if (session_id == null) return { session: null, error: 'Provide session_id' };
  const session = await requireSession(app, session_id, userId);
  if (!session) return { session: null, error: 'Session not found' };
  return { session, error: null };
}

export function applySessionSearchFilters(query, filters, userId) {
  query.where('sessions.user_id', userId);
  if (!filters.include_archived) query.whereNull('sessions.archived_at');
  if (filters.repo_id != null) query.where('sessions.repo_id', filters.repo_id);
  if (filters.is_global) query.where('sessions.is_global', true);
  if (filters.base_branch) query.where('sessions.base_branch', filters.base_branch);
  if (filters.remote_branch) query.where('sessions.remote_branch', filters.remote_branch);
  if (filters.target_branch) {
    query.where((q) => {
      q.where('sessions.local_branch', filters.target_branch).orWhere(
        'sessions.remote_branch',
        filters.target_branch
      );
    });
  }
  if (filters.loop_id != null) query.where('sessions.loop_id', filters.loop_id);
  if (filters.created_after) query.where('sessions.created_at', '>=', filters.created_after);
  if (filters.created_before) query.where('sessions.created_at', '<=', filters.created_before);
  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    query.where((q) => {
      q.where('sessions.label', 'like', term).orWhere('sessions.initial_prompt', 'like', term);
    });
  }
  return query;
}

/** Matches `source` / `subtype` checked in client ChatMessage for MCP styling. */
export function buildMcpUserMessageJson(text) {
  return JSON.stringify({
    type: 'user',
    source: 'mcp',
    subtype: 'mcp',
    content: text,
  });
}

export function summarizeAssistantMessage(row) {
  if (!row) return null;
  let parsed;
  try {
    parsed = JSON.parse(row.message_json);
  } catch {
    parsed = null;
  }
  return {
    id: row.id,
    type: row.type,
    subtype: row.subtype ?? null,
    created_at: row.created_at,
    message: parsed?.message ?? null,
    message_json: row.message_json,
  };
}
