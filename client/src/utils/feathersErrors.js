export function isFeathersNotFound(err) {
  return err?.code === 404 || err?.name === 'NotFound';
}

/** True for errors thrown by the Feathers REST client (`feathers/errors`). */
export function isFeathersError(err) {
  if (!err || typeof err !== 'object') return false;
  if (typeof err.code !== 'number') return false;
  const name = err.name;
  return typeof name === 'string' && name.length > 0 && name !== 'Error';
}
