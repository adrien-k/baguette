/**
 * Agent SDK plugin registry (cross-SDK glue).
 *
 * Each agent SDK ships a self-contained plugin object from its own folder
 * (`server/agent-sdks/<sdk>/index.js`): key/label/meta, the Feathers service
 * registration, model listing, connectivity tests, stream-builder hooks, tool
 * adapters, and capability/credential flags. SDK-agnostic code (agent-configs,
 * message writers, MCP tools) looks helpers up through this registry instead of
 * hardcoding sdk-key branches. To add a new SDK, create `agent-sdks/<sdk>/index.js`
 * and add it to `allSdkPlugins` in the sibling `index.js` manifest — no
 * dispatcher edits needed.
 *
 * Plugin members (all optional except key/label/servicePath):
 * - `register(app, { servicePath })` — mount the Feathers service + registerAgentSdk
 * - `listModels(config, { refresh, user })` — agent-configs `listModels`
 * - `requiresApiKey` — false only when model catalogs work with an empty api_key (mock)
 * - `testConnectivity(config)` — agent-configs `testConnectivity`
 * - `toolCallBuilders()` — MessageStreamWriter tool-call builders (fresh per call)
 * - `resolveModelParams({ models, modelId, user })` — model_params resolution
 * - `adaptTools(genericToolList)` — convert `{ name, description, schema, handler }`
 *   into that SDK's tool objects (Claude MCP server, Cursor customTools, Pi defineTool[])
 * - `supportsModelParams` — session/message model_params (claude, cursor, pi)
 * - `requiresModelParamsOnTurn` — turn start requires model_params (cursor)
 * - `usesAgentPricingTable` — Settings/model picker pricing table (cursor, pi)
 * - `appliesUserModelPrefs` — apply user model-param prefs in the picker (cursor)
 * - `storedSessionIdColumn` — agents-table column for the SDK session id, or null
 * - `hasStoredSession(agent)` — true when that column is set on the agent row
 * - `normalizePickerModelId(id, pickerIds)` — coerce picker ids (Claude 1M alias)
 * - `normalizeApiUrl(url)` — trim/canonicalize api_url when `credentialSchema.hasApiUrl`
 * - `resetUsageTotals(totalsKey)` — drop SDK running-total maps (Claude chat/review deltas)
 * - `usageLabelExtras(row)` — PR/Slack footer extras e.g. `{ fast: boolean }` (Cursor)
 * - `credentialSchema` — JSON-serializable Settings fields:
 *   `{ envVarOptions, defaultEnvVar, hasApiUrl, secretPlaceholder, secretPlaceholderByEnvVar }`
 *
 * `agent-configs.getSdkMetas()` exposes the JSON-serializable subset (see
 * `sdkPluginPublicMeta`). Functions stay on the plugin; server callers use
 * `getSdkPlugin(sdk)`.
 *
 * This module must NOT import any SDK folder; the sibling `index.js` manifest is
 * the only file that enumerates the available SDK plugins.
 */

/** @type {Array<object>} Registered plugins, in registration order. */
const plugins = [];

/**
 * JSON-serializable plugin fields for `agent-configs.getSdkMetas()`.
 * Functions (`adaptTools`, `hasStoredSession`, `normalizePickerModelId`, …) are omitted.
 * Missing capability fields default to false / null so a minimal plugin still registers.
 * @param {object} plugin
 */
export function sdkPluginPublicMeta(plugin) {
  if (!plugin?.key) return null;
  const servicePath = plugin.servicePath ?? plugin.service_path ?? null;
  return {
    key: plugin.key,
    label: plugin.label,
    servicePath,
    service_path: servicePath,
    supportsModelParams: plugin.supportsModelParams === true,
    requiresModelParamsOnTurn: plugin.requiresModelParamsOnTurn === true,
    usesAgentPricingTable: plugin.usesAgentPricingTable === true,
    appliesUserModelPrefs: plugin.appliesUserModelPrefs === true,
    storedSessionIdColumn: plugin.storedSessionIdColumn ?? null,
    requiresApiKey: plugin.requiresApiKey !== false,
    credentialSchema: plugin.credentialSchema ?? null,
  };
}

/**
 * Register an SDK plugin. Idempotent per `key` (re-registration returns the
 * existing plugin so test utilities can call this repeatedly). New capability
 * fields are optional — a `{ key, label, servicePath }` plugin still registers.
 * @param {{ key: string, label: string, servicePath: string }} plugin
 * @returns {object} the registered plugin (first registration wins)
 */
export function registerSdkPlugin(plugin) {
  if (!plugin?.key) throw new Error('registerSdkPlugin: plugin.key is required');
  const existing = getSdkPlugin(plugin.key);
  if (existing) return existing;
  plugins.push(plugin);
  return plugin;
}

/**
 * @param {string} key agent_sdk key, or null/unknown → null
 * Callers outside a booted Feathers app should await
 * `ensureBuiltInSdkPluginsRegistered()` first; production boot registers via
 * `registerAgentSdkServices(app)`.
 */
export function getSdkPlugin(key) {
  if (!key) return null;
  return plugins.find((p) => p.key === key) ?? null;
}

/** @returns {Array<object>} registered plugins in registration order */
export function listSdkPlugins() {
  return [...plugins];
}

/**
 * Agent-row columns that store an SDK conversation id.
 * Plugins with `storedSessionIdColumn: null` (e.g. mock) are omitted.
 * @returns {string[]}
 */
export function storedSessionIdColumns() {
  return listSdkPlugins()
    .map((p) => p.storedSessionIdColumn)
    .filter((col) => typeof col === 'string' && col.length > 0);
}

/**
 * Feathers service path for a registered `agent_sdk` key. Unknown keys fall back
 * to the first registered plugin (mirrors agent-configs' `servicePathForSdk`).
 * @param {string} sdkKey
 */
export function servicePathForSdk(sdkKey) {
  const plugin = sdkKey ? getSdkPlugin(sdkKey) : null;
  if (plugin) return plugin.servicePath;
  return listSdkPlugins()[0]?.servicePath ?? 'claude-agent';
}

/**
 * Record an SDK plugin on the per-app agent-configs service. No-op when that
 * service is not mounted (unit tests that register a single agent service in
 * isolation).
 * @param {import('feathers').Application} app
 * @param {{ key: string, label: string, servicePath: string }} plugin
 */
export function registerAgentSdk(app, plugin) {
  if (!app.services?.['agent-configs']) return;
  const full = getSdkPlugin(plugin.key) ?? plugin;
  return app.service('agent-configs').registerSdk(
    sdkPluginPublicMeta({
      ...full,
      servicePath: plugin.servicePath ?? full.servicePath,
    })
  );
}
