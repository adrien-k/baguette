// Returns pathname+search+hash if value is a same-origin path, else null.
export function toSafePath(value) {
  if (!value) return null;
  try {
    const url = new URL(value, 'http://localhost');
    if (url.origin !== 'http://localhost') return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
