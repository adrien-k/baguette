import { describe, expect, it } from 'vitest';
import { findByRouteId, resolveWorkspaceEntity } from '../useWorkspaceHeaderEntity.js';

describe('findByRouteId', () => {
  const list = [
    { id: 1, name: 'A' },
    { id: 2, name: 'B' },
  ];

  it('matches string and number ids', () => {
    expect(findByRouteId(list, '2')?.name).toBe('B');
    expect(findByRouteId(list, 1)?.name).toBe('A');
  });

  it('returns undefined when missing', () => {
    expect(findByRouteId(list, 9)).toBeUndefined();
    expect(findByRouteId(list, null)).toBeUndefined();
    expect(findByRouteId(undefined, 1)).toBeUndefined();
  });
});

describe('resolveWorkspaceEntity', () => {
  const list = [{ id: 1, name: 'from-list' }];
  const fetched = { id: 1, name: 'from-fetch' };

  it('returns null on the create route', () => {
    expect(
      resolveWorkspaceEntity({
        routeId: 1,
        isNewRoute: true,
        fetched,
        list,
      })
    ).toBeNull();
  });

  it('prefers the fetched record when it matches the route', () => {
    expect(
      resolveWorkspaceEntity({
        routeId: '1',
        isNewRoute: false,
        fetched,
        list,
      })?.name
    ).toBe('from-fetch');
  });

  it('falls back to the list row while fetch is in flight or for another id', () => {
    expect(
      resolveWorkspaceEntity({
        routeId: 1,
        isNewRoute: false,
        fetched: null,
        list,
      })?.name
    ).toBe('from-list');
    expect(
      resolveWorkspaceEntity({
        routeId: 1,
        isNewRoute: false,
        fetched: { id: 99, name: 'stale' },
        list,
      })?.name
    ).toBe('from-list');
  });

  it('returns null when neither fetch nor list has the route', () => {
    expect(
      resolveWorkspaceEntity({
        routeId: 3,
        isNewRoute: false,
        fetched: null,
        list,
      })
    ).toBeNull();
  });
});
