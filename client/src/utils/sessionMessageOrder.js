/** Insert or replace a message so the list stays sorted by ascending id. */
export function insertSessionMessageById(prev, message) {
  const existingIdx = prev.findIndex((m) => m.id === message.id);
  if (existingIdx !== -1) {
    if (prev[existingIdx] === message) return prev;
    const next = [...prev];
    next[existingIdx] = message;
    return next;
  }
  const insertAt = prev.findIndex((m) => m.id > message.id);
  if (insertAt === -1) return [...prev, message];
  return [...prev.slice(0, insertAt), message, ...prev.slice(insertAt)];
}

/**
 * Apply fetched rows onto the loaded list: patch by id, add missing ids, sort by id.
 * @param {object[]} prev
 * @param {object[]} fetched
 */
export function mergeSessionMessagesFromFetch(prev, fetched) {
  if (fetched.length === 0 && prev.every((m, i) => i === 0 || prev[i - 1].id <= m.id)) {
    return prev;
  }
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of fetched) byId.set(m.id, m);
  const merged = Array.from(byId.values()).sort((a, b) => a.id - b.id);
  if (merged.length === prev.length && merged.every((m, i) => m === prev[i])) {
    return prev;
  }
  return merged;
}
