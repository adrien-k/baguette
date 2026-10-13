/** Next session-relative ref (1, 2, 3, …) for issues or todos. */
export async function nextSessionItemRef(db, tableName, sessionId) {
  const row = await db(tableName).where({ session_id: sessionId }).max('ref as max_ref').first();
  const maxRef = row?.max_ref ?? 0;
  return Number(maxRef) + 1;
}
