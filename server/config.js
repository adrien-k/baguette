import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import 'dotenv/config';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const TEST_DATA_DIR = path.join(
  os.tmpdir(),
  `baguette-test-${Math.random().toString(36).slice(2)}`
);

/**
 * Data directory for SQLite DB, repo clones, and worktrees.
 * Set DATA_DIR to override; default is <homedir>/.baguette.
 * Relative paths (e.g. ./.data or .data) are resolved from the project root.
 * In test mode without an explicit DATA_DIR, falls back to a unique temp directory
 * per process so tests never touch the developer's real data.
 */
function getDataDir() {
  const raw =
    process.env.DATA_DIR ??
    (process.env.NODE_ENV === 'test' ? TEST_DATA_DIR : path.join(os.homedir(), '.baguette'));
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(rootDir, raw);
  logger.info({ path: resolved }, 'Using data directory');
  return resolved;
}

export const DATA_DIR = getDataDir();
delete process.env.DATA_DIR;
fs.mkdirSync(DATA_DIR, { recursive: true });

const ENCRYPTION_KEY_PATH = path.join(DATA_DIR, 'encryption.key');

function initEncryptionKey() {
  if (!fs.existsSync(ENCRYPTION_KEY_PATH)) {
    const envKey = process.env.ENCRYPTION_KEY?.trim();
    if (envKey) {
      fs.writeFileSync(ENCRYPTION_KEY_PATH, envKey, { mode: 0o600 });
    } else {
      const generated = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(ENCRYPTION_KEY_PATH, generated, { mode: 0o600 });
      if (process.env.NODE_ENV !== 'test') {
        logger.info(
          { path: ENCRYPTION_KEY_PATH },
          'Created a new encryption key file for this instance'
        );
      }
    }
  }

  let key;
  try {
    key = fs.readFileSync(ENCRYPTION_KEY_PATH, 'utf8').trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read encryption key from ${ENCRYPTION_KEY_PATH}: ${message}`);
  }

  if (!key) {
    throw new Error(`Encryption key at ${ENCRYPTION_KEY_PATH} is empty`);
  }

  try {
    fs.chmodSync(ENCRYPTION_KEY_PATH, 0o600);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to set encryption key permissions on ${ENCRYPTION_KEY_PATH}: ${message}`
    );
  }

  return key;
}

export const ENCRYPTION_KEY = initEncryptionKey();

const DEFAULT_PUBLIC_HOST = process.env.VITE_SERVER_ENABLED
  ? 'http://localhost:5173'
  : 'http://localhost:3000';
const DEFAULT_PUBLIC_API_HOST = 'http://localhost:3000';

export const PUBLIC_HOST = process.env.PUBLIC_HOST || DEFAULT_PUBLIC_HOST;
/**
 * How many reverse-proxy hops sit between Baguette and the internet (kamal-proxy or Fly's
 * router each count as one). X-Forwarded-For is read right-to-left: every proxy appends the
 * address it saw, so only the rightmost `TRUST_PROXY_HOPS` entries cannot be forged by the
 * client. The default of 1 matches all documented deployments. Set 0 when Baguette is
 * exposed directly with no proxy, making the socket address the only trusted source.
 */
export const TRUST_PROXY_HOPS = Math.max(
  0,
  Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10) || 0
);
/** API base URL reachable by browsers and external clients (MCP, uploaded images, etc.). */
export const PUBLIC_API_HOST =
  process.env.PUBLIC_API_HOST ||
  (process.env.PUBLIC_HOST
    ? PUBLIC_HOST
    : process.env.VITE_SERVER_ENABLED
      ? DEFAULT_PUBLIC_API_HOST
      : PUBLIC_HOST);
export const PUBLIC_API_URL = /^https?:\/\//.test(PUBLIC_API_HOST)
  ? PUBLIC_API_HOST
  : `https://${PUBLIC_API_HOST}`;
/** Streamable HTTP MCP — always on the same public origin as the Baguette UI (`/api/mcp`). */
export const MCP_HTTP_ENDPOINT = `${PUBLIC_HOST.replace(/\/$/, '')}/api/mcp`;

/**
 * Resolve a session worktree path for filesystem use. Stored values are relative to DATA_DIR;
 * legacy rows may still hold an absolute path.
 */
export function resolveDataDirRelativePath(relativePath) {
  if (relativePath == null || relativePath === '') return relativePath;
  return path.isAbsolute(relativePath)
    ? path.resolve(relativePath)
    : path.join(DATA_DIR, relativePath);
}

/** SQLite form for the main repo clone: `repos/<stripped>/main` (posix slashes, relative to DATA_DIR). */
export function storedRepoPath(strippedName) {
  return `repos/${strippedName}/main`;
}

/** Resolve `repos.repo_path` for filesystem/git use. */
export function resolveRepoPath(repo) {
  if (!repo) return undefined;
  const stored = repo.repo_path;
  if (stored == null || stored === '') {
    return repo.stripped_name
      ? resolveDataDirRelativePath(storedRepoPath(repo.stripped_name))
      : undefined;
  }
  return resolveDataDirRelativePath(stored);
}

/** Normalize an on-disk main repo clone path before writing `repos.repo_path`. */
export function normalizeRepoPathForStorage(absoluteOrRelativePath, strippedName) {
  const canonical = storedRepoPath(strippedName);
  if (!absoluteOrRelativePath) return canonical;
  const stored = String(absoluteOrRelativePath);
  if (!path.isAbsolute(stored)) {
    return stored.replace(/\\/g, '/');
  }
  const rel = path.relative(DATA_DIR, stored);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join('/');
  }
  const posix = stored.replace(/\\/g, '/');
  if (posix.endsWith(`/${canonical}`)) return canonical;
  const match = posix.match(/\/repos\/[^/]+\/main$/);
  if (match) return match[0].slice(1);
  return canonical;
}

export const REPOS_DIR = resolveDataDirRelativePath('repos');
fs.mkdirSync(REPOS_DIR, { recursive: true });
export const CACHE_DIR = resolveDataDirRelativePath('cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });
export const IMAGES_DIR = resolveDataDirRelativePath('images');
fs.mkdirSync(IMAGES_DIR, { recursive: true });
export const DB_PATH = resolveDataDirRelativePath('baguette.sqlite3');

export const DEFAULT_PAGINATE = { default: 20, max: 100 };
export const MESSAGES_PAGINATE = { default: 100, max: 200 };
