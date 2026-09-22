import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import 'dotenv/config';
import logger from './logger.js';

const DEV_ENCRYPTION_KEY = 'dev-dummy-encryption-key-not-for-production-use!!';

if (process.env.NODE_ENV !== 'production') {
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = DEV_ENCRYPTION_KEY;
    if (process.env.NODE_ENV !== 'test') {
      logger.warn('Using dummy ENCRYPTION_KEY for development. Do not use in production.');
    }
  }
  if (process.env.NODE_ENV !== 'test') {
    for (const key of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) {
      if (!process.env[key]) {
        logger.warn(
          `Missing ${key} — GitHub OAuth disabled. Set it in .env to enable GitHub sign-in.`
        );
      }
    }
  }
} else {
  for (const key of ['ENCRYPTION_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) {
    if (!process.env[key]) {
      throw new Error(
        `Missing required environment variable: ${key}\nSet it in your .env file or environment.`
      );
    }
  }
}

if (process.env.ENCRYPTION_KEY.length < 32) {
  throw new Error('ENCRYPTION_KEY must be at least 32 characters long.');
}

const DEFAULT_PUBLIC_HOST = process.env.VITE_SERVER_ENABLED
  ? 'http://localhost:5173'
  : 'http://localhost:3000';
const DEFAULT_PUBLIC_API_HOST = 'http://localhost:3000';

export const PUBLIC_HOST = process.env.PUBLIC_HOST || DEFAULT_PUBLIC_HOST;
export const PUBLIC_API_HOST =
  process.env.PUBLIC_API_HOST ||
  (process.env.VITE_SERVER_ENABLED ? DEFAULT_PUBLIC_API_HOST : PUBLIC_HOST);
export const PUBLIC_API_URL = /^https?:\/\//.test(PUBLIC_API_HOST)
  ? PUBLIC_API_HOST
  : `https://${PUBLIC_API_HOST}`;
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

/**
 * Slug of the GitHub App (the `<slug>` in github.com/apps/<slug>). When set, Baguette runs in
 * "app" mode: sign-in uses the App's user-to-server flow and the repo picker only lists repos the
 * user selected when installing the App — so access can be scoped to a single repository.
 * When unset, Baguette falls back to the legacy OAuth App flow, which grants access to every repo
 * the user can reach. GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET hold the App's credentials in app
 * mode and the OAuth App's credentials otherwise.
 */
export const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG || null;
export const GITHUB_AUTH_MODE = GITHUB_APP_SLUG ? 'app' : 'oauth';
export const GITHUB_APP_INSTALL_URL = GITHUB_APP_SLUG
  ? `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`
  : null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const TEST_DATA_DIR = path.join(
  os.tmpdir(),
  `baguette-test-${Math.random().toString(36).slice(2)}`
);

export const DATA_DIR = getDataDir();
fs.mkdirSync(DATA_DIR, { recursive: true });

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

export const REPOS_DIR = resolveDataDirRelativePath('repos');
fs.mkdirSync(REPOS_DIR, { recursive: true });
export const CACHE_DIR = resolveDataDirRelativePath('cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });
export const IMAGES_DIR = resolveDataDirRelativePath('images');
fs.mkdirSync(IMAGES_DIR, { recursive: true });
export const DB_PATH = resolveDataDirRelativePath('baguette.sqlite3');
export const DOCKER_COMPOSE_PATH = resolveDataDirRelativePath('docker-compose.yml');
if (!fs.existsSync(DOCKER_COMPOSE_PATH)) {
  fs.writeFileSync(DOCKER_COMPOSE_PATH, 'services:\n\nnetworks:\n  default:\n', 'utf8');
}

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

export const DEFAULT_PAGINATE = { default: 20, max: 100 };
export const MESSAGES_PAGINATE = { default: 100, max: 200 };
