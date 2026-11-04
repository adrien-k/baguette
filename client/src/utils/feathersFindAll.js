/** Matches `DEFAULT_PAGINATE.max` in `server/config.js`. */
export const FEATHERS_FIND_PAGE_SIZE = 100;
const MAX_ROWS = 5000;

export function normalizeFindResult(res) {
  return Array.isArray(res) ? res : (res?.data ?? []);
}

function queryWithoutPaging(query) {
  const baseQuery = { ...query };
  delete baseQuery.$limit;
  delete baseQuery.$skip;
  return baseQuery;
}

/**
 * Fetch every page of a Feathers `find` until `total` is reached.
 * Ignores caller `$limit` / `$skip` so a large `$limit` cannot be silently clamped.
 */
export async function findAllPages(service, query = {}) {
  const baseQuery = queryWithoutPaging(query);
  const first = await service.find({
    query: { ...baseQuery, $limit: FEATHERS_FIND_PAGE_SIZE, $skip: 0 },
  });
  if (Array.isArray(first)) return first;

  const rows = [...normalizeFindResult(first)];
  const total = typeof first?.total === 'number' ? first.total : rows.length;
  let skip = rows.length;
  while (skip < total && rows.length < MAX_ROWS) {
    const res = await service.find({
      query: { ...baseQuery, $limit: FEATHERS_FIND_PAGE_SIZE, $skip: skip },
    });
    if (Array.isArray(res)) {
      rows.push(...res);
      break;
    }
    const page = normalizeFindResult(res);
    if (page.length === 0) break;
    rows.push(...page);
    skip += page.length;
  }
  return rows;
}
