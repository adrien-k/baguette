import { resolveWebserverConfig, resolveServicesConfig } from './baguette-config.js';
import { getPreviewHost, getServicePreviewHost } from './preview.js';

/** Normalize scheme to include `://` (e.g. `exp` → `exp://`). */
export function normalizePreviewScheme(scheme) {
  if (!scheme || typeof scheme !== 'string') return null;
  const trimmed = scheme.trim();
  if (!trimmed) return null;
  return trimmed.endsWith('://') ? trimmed : `${trimmed}://`;
}

/** Build a deep-link URL from an https preview URL and a custom scheme. */
export function buildDeepLinkUrl(scheme, httpsUrl) {
  const normalized = normalizePreviewScheme(scheme);
  if (!normalized || !httpsUrl) return null;
  try {
    const u = new URL(httpsUrl);
    return `${normalized}${u.host}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

function webserverTaskLabel(serviceName = 'default') {
  return `baguette:webserver:${serviceName}`;
}

/**
 * Resolve preview service config by name (`default` for single webserver).
 */
export function resolvePreviewServiceConfig(baguetteConfig, serviceName) {
  if (serviceName === 'default') return resolveWebserverConfig(baguetteConfig);
  const services = resolveServicesConfig(baguetteConfig);
  return services?.find((s) => s.name === serviceName) ?? null;
}

/**
 * List preview services defined in .baguette.yaml (webserver or services block).
 * @returns {Array<{ name, display_name, description, url, expose, task_key, task_label, deep_link_url }>|null}
 */
export function getPreviewServiceDefinitions(baguetteConfig, shortId) {
  if (!baguetteConfig || !shortId) return null;

  const globalScheme = baguetteConfig.preview?.scheme ?? baguetteConfig.webserver?.scheme ?? null;

  const webserver = resolveWebserverConfig(baguetteConfig);
  if (webserver) {
    const url = getPreviewHost(shortId);
    const scheme = baguetteConfig.webserver?.scheme ?? globalScheme;
    return [
      {
        name: 'default',
        display_name: webserver.taskKey || 'webserver',
        description: webserver.description ?? null,
        url,
        expose: webserver.expose,
        task_key: webserver.taskKey,
        task_label: webserverTaskLabel('default'),
        deep_link_url: buildDeepLinkUrl(scheme, url),
      },
    ];
  }

  const services = resolveServicesConfig(baguetteConfig);
  if (!services?.length) return null;

  const servicesBlock = baguetteConfig.services ?? {};
  return services.map((svc) => {
    const url = getServicePreviewHost(shortId, svc.name);
    const scheme = servicesBlock[svc.name]?.scheme ?? globalScheme;
    return {
      name: svc.name,
      display_name: svc.name,
      description: svc.description ?? null,
      url,
      expose: svc.expose,
      task_key: svc.taskKey,
      task_label: webserverTaskLabel(svc.name),
      deep_link_url: buildDeepLinkUrl(scheme, url),
    };
  });
}

export function sessionHasPreviewConfig(baguetteConfig) {
  if (!baguetteConfig) return false;
  if (baguetteConfig.webserver) return true;
  const services = resolveServicesConfig(baguetteConfig);
  return !!services?.length;
}

/** Preview portal URL when the session worktree has preview config; otherwise null. */
export function getSessionPreviewUrl(session, baguetteConfig) {
  if (!session?.short_id || !sessionHasPreviewConfig(baguetteConfig)) return null;
  return getPreviewHost(session.short_id);
}
