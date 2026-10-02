export function isFeathersNotFound(err) {
  return err?.code === 404 || err?.name === 'NotFound';
}
