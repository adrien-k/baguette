/** Match Feathers errors across `feathers/errors` and transitive `@feathersjs/errors`. */

export function isFeathersNotFound(err) {
  return err?.name === 'NotFound' || err?.code === 404;
}

export function isFeathersBadRequest(err) {
  return err?.name === 'BadRequest' || err?.code === 400;
}
