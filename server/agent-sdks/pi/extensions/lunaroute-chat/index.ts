/**
 * Baguette chat-only LunaRoute Pi extension (no MCP web/image/convert tools).
 * API keys come from Baguette agent config via OAuth credential seeding in `pi-models.js`.
 */
import { VERSION, type ExtensionAPI, type ProviderConfig } from '@earendil-works/pi-coding-agent';
import { LUNAROUTE_PROVIDER } from './constants.js';
import { buildAttributionHeaders, newSessionId, resolveApi, resolveRoutingUrl } from './env.js';
import { lunarouteOAuth } from './oauth.js';
import { createRefreshModels } from './discovery.js';
import { readPersistedModels } from './persisted.js';

const sessionId = newSessionId();

export default function baguetteLunarouteChatExtension(
  pi: ExtensionAPI,
  version: string = VERSION
): void {
  const providerConfig: ProviderConfig = {
    name: 'LunaRoute',
    baseUrl: resolveRoutingUrl(process.env),
    api: resolveApi(process.env),
    authHeader: true,
    headers: buildAttributionHeaders(version, sessionId),
    oauth: lunarouteOAuth,
    refreshModels: createRefreshModels(process.env),
    models: readPersistedModels(process.env),
  };
  pi.registerProvider(LUNAROUTE_PROVIDER, providerConfig);
}
