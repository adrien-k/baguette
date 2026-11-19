import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLunaroutePiApiKeyEnvVar } from '../../../shared/pi-api-key-env-vars.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LUNAROUTE_EXTENSION_DIR = path.join(__dirname, 'extensions', 'lunaroute-chat');

/** Absolute path to the in-repo chat-only LunaRoute Pi extension (loaded by Pi via jiti). */
export function getBundledLunaroutePiExtensionPath() {
  const tsEntry = path.join(LUNAROUTE_EXTENSION_DIR, 'index.ts');
  if (existsSync(tsEntry)) return tsEntry;
  return path.join(LUNAROUTE_EXTENSION_DIR, 'index.js');
}

/** Pi `DefaultResourceLoader` extension paths when the agent config uses LunaRoute. */
export function lunaroutePiAdditionalExtensionPaths(envVar) {
  if (!isLunaroutePiApiKeyEnvVar(envVar)) return [];
  return [getBundledLunaroutePiExtensionPath()];
}
