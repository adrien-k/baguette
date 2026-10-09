async function findPlanRow(app, sessionId, userId) {
  const result = await app.service('session-plans').find({
    query: { session_id: sessionId, $limit: 1 },
    paginate: false,
    user: { id: userId },
  });
  const rows = Array.isArray(result) ? result : (result?.data ?? []);
  return rows[0] ?? null;
}

export async function readSessionPlanMarkdown(app, session) {
  if (!session?.id) {
    return { markdown: '', missing: true };
  }
  const row = await findPlanRow(app, session.id, session.user_id);
  if (!row) {
    return { markdown: '', missing: true };
  }
  return { markdown: row.markdown ?? '', missing: false };
}
