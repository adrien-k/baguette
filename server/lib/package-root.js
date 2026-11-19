import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Repo / npm package root (parent of `server/` or parent of `dist/`). */
export function packageRoot() {
  const parent = path.dirname(serverDir);
  if (path.basename(parent) === 'dist') return path.resolve(serverDir, '../..');
  return path.resolve(serverDir, '..');
}
