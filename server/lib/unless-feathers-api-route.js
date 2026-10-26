/**
 * Feathers v6 HTTP (`createHandler` + `toNodeHandler`) parses request bodies from the
 * raw Node stream. Skip Express body parsers on `/api/*` so they do not consume the
 * stream before Feathers runs (which yields 400 "Invalid request body" on POST).
 */
export function unlessFeathersApiRoute(middleware) {
  return (req, res, next) => {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (path === '/api' || path.startsWith('/api/')) {
      return next();
    }
    return middleware(req, res, next);
  };
}
