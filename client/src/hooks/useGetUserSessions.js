import { useCallback, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { sessionsService } from '../feathers.js';
import { sortSessionsForList } from '@baguette/shared/session-sort.js';
import { sessionKeys } from '../queries/keys.js';
import { feathersFindPage } from '../queries/feathersFinders.js';

const PAGE_SIZE = 50;

/**
 * Count unique session ids across pages, mirroring `flattenSessionPages`.
 *
 * Realtime events can prepend the same row to several cached pages (a row the
 * window does not contain yet is inserted into every page by the bridge), so
 * raw page row-counts overstate the loaded window. Offsets must derive from
 * the deduped count or `fetchNextPage` permanently skips server rows that
 * fall in the duplicated gap.
 */
function countUniqueSessionRows(pages) {
  const seen = new Set();
  for (const page of pages) {
    for (const row of page?.data ?? []) {
      if (row?.id != null) seen.add(row.id);
    }
  }
  return seen.size;
}

/**
 * Flatten infinite-query pages into one deduped, list-sorted session array.
 * Dedupe guards against realtime inserts duplicating a row across pages.
 */
function flattenSessionPages(data) {
  const rows = [];
  const seen = new Set();
  for (const page of data?.pages ?? []) {
    for (const row of page?.data ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return sortSessionsForList(rows);
}

/**
 * Returns sessions for the current user, filtered on the server.
 * `listQuery` is sent on every page; only `$skip` / `$limit` change on load more.
 *
 * Realtime updates (SSE `created`/`patched`/`removed`, agent patches) are
 * applied to the query cache by the central `sseCacheBridge`; this hook only
 * reads and flattens the cached pages.
 */
export function useGetUserSessions(listQuery = {}) {
  const { data, isPending, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: sessionKeys.list(listQuery),
      queryFn: async ({ pageParam }) => {
        const { rows, total } = await feathersFindPage(sessionsService, {
          $limit: PAGE_SIZE,
          $skip: pageParam,
          ...listQuery,
        });
        // Pages store `{ data, total }` — the shape the cache bridge updaters
        // and `flattenSessionPages` read back.
        return { data: rows, total };
      },
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) => {
        const loaded = countUniqueSessionRows(allPages);
        const total = lastPage?.total ?? loaded;
        return loaded < total && (lastPage?.data?.length ?? 0) > 0 ? loaded : undefined;
      },
    });

  const sessions = useMemo(() => flattenSessionPages(data), [data]);

  const refetchSilently = useCallback(
    (opts) => {
      // `silent` callers only wanted no loading spinner; React Query refetch
      // keeps showing existing data either way.
      void opts;
      return refetch().then(() => undefined);
    },
    [refetch]
  );

  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    sessions,
    loading: isPending,
    error: error ?? null,
    refetch: refetchSilently,
    hasMore: hasNextPage,
    loadMore,
  };
}
