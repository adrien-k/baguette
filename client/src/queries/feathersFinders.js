import { normalizeFindResult } from '../utils/feathersFindAll.js';

/**
 * Normalize a Feathers `find` response into `{ rows, total }`.
 * Plain-array responses (non-paginated services) report `total = rows.length`.
 */
export function normalizeFindResponse(res) {
  const rows = normalizeFindResult(res);
  const total = Array.isArray(res) ? rows.length : Number(res?.total ?? rows.length);
  return { rows, total };
}

/** Feathers `find` returning normalized `{ rows, total }`. */
export async function feathersFindPage(service, query) {
  const res = await service.find({ query });
  return normalizeFindResponse(res);
}

/** Feathers `find` returning just the rows. */
export async function feathersFind(service, query) {
  const { rows } = await feathersFindPage(service, query);
  return rows;
}

/** Feathers `get`. */
export function feathersGet(service, id) {
  return service.get(id);
}
