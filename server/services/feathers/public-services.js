import { Forbidden } from 'feathers/errors';

/**
 * Declarative registry of Feathers services that external clients (the HTTP transport)
 * may call. Everything registered on the app but NOT listed here is internal-only:
 * external calls are rejected by the `requirePublicService` app hook before any service
 * hook runs.
 *
 * Being listed grants *reachability* only — each listed service still enforces
 * authentication (`requireUser`) and ownership scoping (`scopeByUser` /
 * `scopeBySessionUser`) in its own hooks. A new service is therefore external-invisible
 * by default and must be added here deliberately.
 */
const PUBLIC_SERVICES = [
  'admin/plugins',
  'admin/slack',
  'agent-configs',
  'agent-model-presets',
  'agents',
  'loops',
  'messages',
  'queued-messages',
  'repos',
  'secrets',
  'session-issues',
  'session-plans',
  'session-todos',
  'sessions',
  'sse',
  'tasks',
  'usage',
  'usage-model-pricing',
  'user-repos',
  'users',
];

/**
 * App-level before hook: reject external calls to services that are not in
 * PUBLIC_SERVICES. Internal calls (no transport `provider`) are always allowed.
 * Registered on the application in `createFeathersApp` so it applies to every
 * service regardless of registration order.
 */
export function requirePublicService(context) {
  if (!context.params?.provider) return context;
  if (PUBLIC_SERVICES.includes(context.path)) return context;
  throw new Forbidden(`Service "${context.path}" is not accessible externally`);
}
