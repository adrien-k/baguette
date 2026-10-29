import { useState, useEffect, useMemo } from 'react';

/** Match a sidebar/list row to the current route id. */
export function findByRouteId(list, routeId) {
  if (routeId == null || routeId === '') return undefined;
  return list?.find((item) => String(item.id) === String(routeId));
}

/**
 * Prefer the fetched record when it matches the route; otherwise the list row.
 * Synchronous so workspace headers can render the current name on the first paint.
 */
export function resolveWorkspaceEntity({ routeId, isNewRoute, fetched, list }) {
  if (isNewRoute || routeId == null || routeId === '') return null;
  if (fetched && String(fetched.id) === String(routeId)) return fetched;
  return findByRouteId(list, routeId) ?? null;
}

/**
 * Shared session/loop header loading: list hydration + last-known snapshot.
 * Show chrome when `isNewRoute || entity`. Use `headerEntity` for the title row
 * (falls back to snapshot only while `entity` is briefly null on the same route).
 */
export function useWorkspaceHeaderEntity({ routeId, isNewRoute, fetched, list }) {
  const entity = useMemo(
    () => resolveWorkspaceEntity({ routeId, isNewRoute, fetched, list }),
    [routeId, isNewRoute, fetched, list]
  );

  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (isNewRoute) {
      setSnapshot(null);
      return;
    }
    if (entity) setSnapshot(entity);
  }, [entity, isNewRoute]);

  return {
    entity,
    headerEntity: entity ?? snapshot,
    awaiting: !isNewRoute && Boolean(routeId) && !entity,
  };
}
