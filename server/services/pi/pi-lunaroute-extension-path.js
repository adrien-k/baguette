import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLunaroutePiApiKeyEnvVar } from '../../../shared/pi-api-key-env-vars.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the in-repo chat-only LunaRoute Pi extension (loaded by Pi via jiti). */
export function getBundledLunaroutePiExtensionPath() {
  return path.join(__dirname, '..', '..', 'pi', 'extensions', 'lunaroute-chat', 'index.ts');
}

/** Pi `DefaultResourceLoader` extension paths when the agent config uses LunaRoute. */
export function lunaroutePiAdditionalExtensionPaths(envVar) {
  if (!isLunaroutePiApiKeyEnvVar(envVar)) return [];
  return [getBundledLunaroutePiExtensionPath()];
}
