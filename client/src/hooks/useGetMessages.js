import { useCallback, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { messagesService } from '../feathers.js';
import { messageKeys } from '../queries/keys.js';
import { normalizeFindResponse } from '../queries/feathersFinders.js';

const PAGE_SIZE = 100;

function messageQueryFilter(sessionId, agentId) {
  const query = { session_id: sessionId, $sort: { id: -1 }, $limit: PAGE_SIZE };
  if (agentId != null) query.agent_id = agentId;
  return query;
}

async function fetchMessagePage(sessionId, agentId, beforeId) {
  const query = messageQueryFilter(sessionId, agentId);
  if (beforeId != null) query.id = { $lt: beforeId };
  const { rows } = await normalizeFindResponse(await messagesService.find({ query }));
  // Server returns newest-first; pages are stored ascending for display.
  return [...rows].reverse();
}

/** Flatten infinite pages into one id-ascending message array (deduped). */
function flattenMessagePages(data) {
  const rows = [];
  const seen = new Set();
  for (const page of data?.pages ?? []) {
    for (const message of page ?? []) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      rows.push(message);
    }
  }
  return rows.sort((a, b) => a.id - b.id);
}

/**
 * Returns messages for a session agent with cursor-based pagination (oldest
 * page fetched on demand). Realtime created/patched events are applied to the
 * query cache by the central `sseCacheBridge`; SSE reconnects refetch the
 * loaded pages through the global reconnect wiring.
 *
 * @param {number|null} sessionId
 * @param {number|null} agentId - when set, load that agent's transcript
 * @param {{ skip?: boolean }} [options]
 */
export function useGetMessages(sessionId, agentId = null, options = {}) {
  const { skip = false } = options;
  const enabled = !skip && sessionId != null;

  const query = useInfiniteQuery({
    queryKey: messageKeys.session(sessionId, agentId),
    queryFn: ({ pageParam }) => fetchMessagePage(sessionId, agentId, pageParam ?? null),
    initialPageParam: null,
    getNextPageParam: (lastPage) => (lastPage.length === PAGE_SIZE ? lastPage[0].id : undefined),
    enabled,
  });

  const messages = useMemo(
    () => (enabled ? flattenMessagePages(query.data) : []),
    [enabled, query.data]
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    messages,
    loading: enabled && query.isPending,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    loadMore,
    error: query.error ?? null,
  };
}
