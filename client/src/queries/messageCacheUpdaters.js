import { insertSessionMessageById } from '../utils/sessionMessageOrder.js';
import { sameScopeId } from '../utils/boundScope.js';

/**
 * Does a message event belong in a messages cache entry keyed
 * `['messages', sessionId, agentId]`? An entry with `agentId = null` holds every
 * agent's transcript; otherwise it holds only that agent's messages.
 */
export function messageEventMatchesKey(keySessionId, keyAgentId, message) {
  if (!message?.id) return false;
  if (!sameScopeId(keySessionId, message.session_id)) return false;
  if (keyAgentId == null) return true;
  return sameScopeId(keyAgentId, message.agent_id);
}

/**
 * Insert/replace a realtime message into an infinite messages cache entry
 * (`{ pages, pageParams }`, each page an id-ascending array; pages[0] holds the
 * newest window). Returns the same reference when nothing matched.
 *
 * Known ids are replaced in place. Unknown ids (created events) insert into the
 * newest page only when newer than its last row — an unknown id below the
 * loaded window belongs to an unfetched page, so the cache stays untouched.
 */
export function applyMessageEventToInfiniteMessages(data, message) {
  if (!data?.pages || !message?.id) return data;
  let changed = false;
  let replaced = false;
  let pages = data.pages.map((page) => {
    const rows = Array.isArray(page) ? page : [];
    const found = rows.some((m) => m.id === message.id);
    if (!found) return page;
    replaced = true;
    const next = insertSessionMessageById(rows, message);
    if (next === rows) return page;
    changed = true;
    return next;
  });
  if (replaced) return changed ? { ...data, pages } : data;

  const firstRows = Array.isArray(pages[0]) ? pages[0] : [];
  const newestLoadedId = firstRows.length ? firstRows[firstRows.length - 1].id : null;
  if (newestLoadedId != null && message.id <= newestLoadedId) return data;
  const nextFirst = insertSessionMessageById(firstRows, message);
  if (nextFirst === firstRows) return data;
  pages = [nextFirst, ...pages.slice(1)];
  return { ...data, pages };
}
