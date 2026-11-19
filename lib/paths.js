import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** npm package root (directory with package.json). */
export function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** Compiled server when `dist/server/index.js` exists, else source `server/`. */
export function resolveServerDir(root = packageRoot()) {
  const distServer = path.join(root, 'dist', 'server');
  if (fs.existsSync(path.join(distServer, 'index.js'))) return distServer;
  return path.join(root, 'server');
}

/** Path to `server/index.js` or `dist/server/index.js` for starting the app. */
export function resolveServerEntry(root = packageRoot()) {
  return path.join(resolveServerDir(root), 'index.js');
}
