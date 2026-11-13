import { listSdkPlugins } from './registry.js';

let pending = null;

/**
 * Idempotently register built-in SDK plugins. Dynamically imports the manifest so
 * plugin subgraphs (e.g. agent-service → dispatchers) do not static-import `index.js`
 * while a plugin module is still evaluating.
 */
export async function ensureBuiltInSdkPluginsRegistered() {
  if (listSdkPlugins().length > 0) {
    return;
  }
  if (!pending) {
    pending = import('./index.js')
      .then((mod) => {
        mod.registerAllSdkPlugins();
      })
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  await pending;
}
