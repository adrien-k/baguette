/**
 * Agent SDK manifest — the ONLY file that enumerates the built-in SDK plugins.
 * Each plugin is a self-contained folder under `agent-sdks/<sdk>/` (see the
 * contract in `./registry.js`).
 *
 * Importing this file registers every plugin on the module-level registry
 * (idempotent), so SDK-agnostic dispatchers can rely on the registry alone.
 */
import { claudeAgentSdkPlugin } from './claude/index.js';
import { cursorAgentSdkPlugin } from './cursor/index.js';
import { piAgentSdkPlugin } from './pi/index.js';
import { mockAgentSdkPlugin } from './mock/index.js';
import { registerSdkPlugin } from './registry.js';

/** Built-in plugins in registration order (claude first — servicePathForSdk fallback). */
const allSdkPlugins = [
  claudeAgentSdkPlugin,
  cursorAgentSdkPlugin,
  piAgentSdkPlugin,
  mockAgentSdkPlugin,
];

/** Idempotently register all built-in plugins on the module-level registry. */
export function registerAllSdkPlugins() {
  for (const plugin of allSdkPlugins) {
    registerSdkPlugin(plugin);
  }
  return allSdkPlugins;
}

/** Register every SDK plugin (registry entry + Feathers service mount) on an app. */
export function registerAgentSdkServices(app) {
  registerAllSdkPlugins();
  for (const plugin of allSdkPlugins) {
    plugin.register(app);
  }
}
