import { describe, expect, it, vi } from 'vitest';
import { FEATHERS_FIND_PAGE_SIZE, findAllPages, normalizeFindResult } from '../feathersFindAll.js';

function pagedService(pages) {
  return {
    find: vi.fn(async ({ query }) => {
      const skip = query.$skip ?? 0;
      const index = skip / FEATHERS_FIND_PAGE_SIZE;
      return pages[index] ?? { total: pages[0]?.total ?? 0, data: [] };
    }),
  };
}

describe('normalizeFindResult', () => {
  it('returns arrays as-is', () => {
    const rows = [{ id: 1 }];
    expect(normalizeFindResult(rows)).toBe(rows);
  });

  it('unwraps paginated data', () => {
    expect(normalizeFindResult({ total: 1, data: [{ id: 1 }] })).toEqual([{ id: 1 }]);
  });
});

describe('findAllPages', () => {
  it('returns a non-paginated array result', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const service = { find: vi.fn(async () => rows) };
    await expect(findAllPages(service, { session_id: 9 })).resolves.toEqual(rows);
    expect(service.find).toHaveBeenCalledTimes(1);
  });

  it('fetches remaining pages from total', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const second = Array.from({ length: 50 }, (_, i) => ({ id: i + 101 }));
    const service = pagedService([
      { total: 150, data: first },
      { total: 150, data: second },
    ]);
    const rows = await findAllPages(service, { session_id: 3, $sort: { ref: 1 }, $limit: 500 });
    expect(rows).toHaveLength(150);
    expect(rows[0].id).toBe(1);
    expect(rows[149].id).toBe(150);
    expect(service.find).toHaveBeenCalledTimes(2);
    expect(service.find.mock.calls[0][0].query).toMatchObject({
      session_id: 3,
      $sort: { ref: 1 },
      $limit: FEATHERS_FIND_PAGE_SIZE,
      $skip: 0,
    });
    expect(service.find.mock.calls[1][0].query.$skip).toBe(100);
  });

  it('stops when a later page is empty', async () => {
    const service = pagedService([
      { total: 200, data: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) },
      { total: 200, data: [] },
    ]);
    const rows = await findAllPages(service);
    expect(rows).toHaveLength(100);
    expect(service.find).toHaveBeenCalledTimes(2);
  });
});
