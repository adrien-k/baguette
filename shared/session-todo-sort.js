/** List order: sort_order ascending, then session ref (#1 first), then id. */
export function compareSessionTodosAsc(a, b) {
  const sortA = a.sort_order ?? 0;
  const sortB = b.sort_order ?? 0;
  if (sortA !== sortB) return sortA - sortB;

  const refA = a.ref ?? Number.MAX_SAFE_INTEGER;
  const refB = b.ref ?? Number.MAX_SAFE_INTEGER;
  if (refA !== refB) return refA - refB;

  return (a.id ?? 0) - (b.id ?? 0);
}

export function sortSessionTodosAsc(todos) {
  return [...todos].sort(compareSessionTodosAsc);
}
