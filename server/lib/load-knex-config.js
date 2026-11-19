import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageRoot } from './package-root.js';

/** Knex config from package-root `knexfile.js` (works from source or `dist/server`). */
export async function loadKnexConfig() {
  const mod = await import(pathToFileURL(path.join(packageRoot(), 'knexfile.js')).href);
  return mod.default;
}
