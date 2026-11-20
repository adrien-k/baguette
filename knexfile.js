import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolveServerDir } from './lib/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = resolveServerDir(rootDir);
const { DB_PATH } = await import(pathToFileURL(path.join(serverDir, 'config.js')).href);

const SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function formatDates(row) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    out[key] =
      typeof val === 'string' && SQLITE_TIMESTAMP_RE.test(val)
        ? val.replace(' ', 'T') + '.000Z'
        : val;
  }
  return out;
}

export default {
  client: 'better-sqlite3',
  connection: {
    filename: DB_PATH,
  },
  migrations: {
    directory: path.join(serverDir, 'migrations'),
  },
  useNullAsDefault: true,
  postProcessResponse: (result) => {
    if (Array.isArray(result))
      return result.map((row) => (row && typeof row === 'object' ? formatDates(row) : row));
    if (result && typeof result === 'object') return formatDates(result);
    return result;
  },
};
