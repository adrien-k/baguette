import { PUBLIC_HOST } from '../config.js';

const HOSTNAME_MAX_LENGTH = 253;

/**
 * Lowercase hostname (no port) from a Host header value.
 * Returns null for missing, malformed, or too-long values.
 */
export function hostnameFromHostHeader(host) {
  if (typeof host !== 'string' || host.trim() === '' || host.length > HOSTNAME_MAX_LENGTH + 6) {
    return null;
  }
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The bare apex domain served by PUBLIC_HOST, or null when there is no www
 * variant to redirect from. `https://www.baguette.example.com` →
 * `baguette.example.com`; a PUBLIC_HOST without the `www.` prefix returns
 * null (nothing to redirect).
 */
export function getApexFromPublicHost(publicHost) {
  let hostname;
  try {
    hostname = new URL(publicHost).hostname;
  } catch {
    return null;
  }
  return hostname.startsWith('www.') ? hostname.slice('www.'.length) : null;
}

/**
 * Express middleware: 301 redirects requests arriving on the bare apex host
 * (e.g. `baguette.example.com`) to the www canonical host derived from
 * PUBLIC_HOST (e.g. `https://www.baguette.example.com`), preserving the path
 * and query. Only the bare apex is redirected — `www.` and session preview
 * subdomains (`session-<id>.<DOMAIN>`) pass through untouched. When PUBLIC_HOST
 * has no `www.` prefix the middleware is a no-op.
 */
export function createApexRedirect({ publicHost = PUBLIC_HOST } = {}) {
  const apex = getApexFromPublicHost(publicHost);
  const target = apex ? publicHost.replace(/\/+$/, '') : null;

  return function apexRedirect(req, res, next) {
    if (!target) return next();

    const requestHost = hostnameFromHostHeader(req.headers?.host ?? req.hostname);
    if (requestHost !== apex) return next();

    res.redirect(301, `${target}${req.url}`);
  };
}
