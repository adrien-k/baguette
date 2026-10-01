import { resolveServicesConfig } from './baguette-config.js';
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

/** Key used to find/reuse the in-memory task for a preview service. */
export function previewTaskLookupKey(serviceConfig) {
  return serviceConfig.taskKey;
}

/**
 * Resolve preview service config by name. When `serviceName` is omitted, returns the sole
 * service when exactly one is configured.
 */
export function resolvePreviewServiceConfig(baguetteConfig, serviceName) {
  const services = resolveServicesConfig(baguetteConfig) ?? [];
  if (serviceName) {
    return services.find((s) => s.name === serviceName) ?? null;
  }
  if (services.length === 1) return services[0];
  return null;
}

/**
 * List preview services defined in `.baguette.yaml` (`services` block).
 * @returns {Array<{ name, display_name, description, url, expose, task_key, task_label, deep_link_url }>|null}
 */
export function getPreviewServiceDefinitions(baguetteConfig, shortId) {
  if (!baguetteConfig || !shortId) return null;

  const services = resolveServicesConfig(baguetteConfig);
  if (!services?.length) return null;

  const servicesBlock = baguetteConfig.services ?? {};
  return services.map((svc) => {
    const url = getServicePreviewHost(shortId, svc.name);
    const scheme = servicesBlock[svc.name]?.scheme ?? null;
    return {
      name: svc.name,
      display_name: svc.name,
      description: svc.description ?? null,
      url,
      expose: svc.expose,
      task_key: svc.taskKey,
      task_label: previewTaskLookupKey(svc),
      deep_link_url: buildDeepLinkUrl(scheme, url),
    };
  });
}

export function sessionHasPreviewConfig(baguetteConfig) {
  if (!baguetteConfig) return false;
  const servicesBlock = baguetteConfig.services;
  if (!servicesBlock || typeof servicesBlock !== 'object') return false;
  return Object.keys(servicesBlock).length > 0;
}

/** Primary preview URL for the session (service subdomain when only one service is defined). */
export function getSessionPreviewUrl(session, baguetteConfig) {
  if (!session?.short_id || !sessionHasPreviewConfig(baguetteConfig)) return null;
  const definitions = getPreviewServiceDefinitions(baguetteConfig, session.short_id);
  if (definitions?.length === 1) return definitions[0].url;
  return getPreviewHost(session.short_id);
}
