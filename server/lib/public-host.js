import path from 'node:path';
import dotenv from 'dotenv';
import { packageRoot } from './package-root.js';

const DEFAULT_DEV_DOMAIN = '127.0.0.1.traefik.me';

/** Whether derived `PUBLIC_HOST` uses `https` (default: true in production, false otherwise). */
export function resolveUseHttps(processEnv = process.env) {
  return processEnv.NODE_ENV === 'production';
}

/** Load `.env` from the package root (same path as `server/config.js`). */
export function loadRootDotenv() {
  // Tests must not depend on a developer's local .env (PUBLIC_HOST, AUTH_GITHUB_*, ...).
  if (process.env.NODE_ENV === 'test') return;
  dotenv.config({ path: path.join(packageRoot(), '.env') });
}

function resolveDomain(processEnv = process.env) {
  const domainFromEnv = typeof processEnv.DOMAIN === 'string' ? processEnv.DOMAIN.trim() : '';
  const useDevDomainDefault =
    processEnv.NODE_ENV !== 'production' && processEnv.NODE_ENV !== 'test';
  return domainFromEnv || (useDevDomainDefault ? DEFAULT_DEV_DOMAIN : undefined);
}

/**
 * In production, configure how browsers reach Baguette with **either**:
 * - `PUBLIC_HOST` — full public UI URL (scheme, host, optional port), or
 * - `DOMAIN` — apex hostname;  build `PUBLIC_HOST` as `https://www.<DOMAIN>`
 *
 * When `PUBLIC_HOST` is set, `DOMAIN` is unused.
 */
export function assertProductionDomainConfigured(processEnv = process.env) {
  if (processEnv.NODE_ENV !== 'production') return;
  const publicHost = processEnv.PUBLIC_HOST?.trim();
  const domainFromEnv = typeof processEnv.DOMAIN === 'string' ? processEnv.DOMAIN.trim() : '';
  if (publicHost || domainFromEnv) return;
  throw new Error(
    'When NODE_ENV=production, set PUBLIC_HOST (full URL) or DOMAIN (apex hostname; optional PORT). See README.md#environment-variables.'
  );
}

/** Canonical public UI URL; matches `PUBLIC_HOST` in `server/config.js`. */
export function resolvePublicHost(processEnv = process.env) {
  const explicit = processEnv.PUBLIC_HOST?.trim();
  if (explicit) return explicit;

  const domain = resolveDomain(processEnv);
  const localhost =
    processEnv.VITE_SERVER_ENABLED === 'true' ? 'http://localhost:5173' : 'http://localhost:3000';
  if (!domain) return localhost;

  if (processEnv.VITE_SERVER_ENABLED === 'true') {
    return `http://www.${domain}:5173`;
  }

  const https = resolveUseHttps(processEnv);
  const scheme = https ? 'https' : 'http';
  const port = processEnv.PORT ?? '3000';
  const omitPort = https && processEnv.NODE_ENV === 'production';
  const portSuffix = omitPort ? '' : `:${port}`;
  return `${scheme}://www.${domain}${portSuffix}`;
}

export function publicHostHostname(processEnv = process.env) {
  try {
    return new URL(resolvePublicHost(processEnv)).hostname;
  } catch {
    return null;
  }
}

/**
 * Base public URL for session preview/code subdomains (Express). With Vite dev and no explicit
 * `PUBLIC_HOST`, the UI is on port 5173 but subdomain routing still hits Express on `PORT`.
 */
export function resolveSessionSubdomainPublicUrl(processEnv = process.env) {
  const url = new URL(resolvePublicHost(processEnv));
  const explicit = processEnv.PUBLIC_HOST?.trim();
  if (processEnv.VITE_SERVER_ENABLED === 'true' && !explicit) {
    const port = Number.parseInt(processEnv.PORT ?? '3000', 10) || 3000;
    url.port = String(port);
  }
  return `${url.protocol}//${url.host}`;
}
