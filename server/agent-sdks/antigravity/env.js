import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitAuthorEnvFromUser } from '../../services/git-identity.js';
import { stripServerEnv } from '../../services/session-env.js';

/**
 * Parse `agent_configs.extra_env_json` safely into string key/value pairs.
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function parseExtraEnvJson(raw) {
  if (raw == null || raw === '') return {};
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    const key = String(k).trim();
    if (!key || v == null) continue;
    out[key] = String(v);
  }
  return out;
}

function isExecutableFile(candidate, fsImpl = fs) {
  if (!candidate) return false;
  try {
    fsImpl.accessSync(candidate, fsImpl.constants?.X_OK ?? fs.constants.X_OK);
    const stat = fsImpl.statSync(candidate);
    return !stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve the local `agy` CLI executable path.
 * Checks explicit overrides (`ANTIGRAVITY_BIN` / `AGY_BIN`), `PATH` entries,
 * and standard user install paths (`~/.gemini/bin/agy`, `~/.local/bin/agy`, Homebrew/usr).
 * Skips dangling symlinks (e.g. legacy `~/.antigravity/antigravity/bin/agy`).
 *
 * @param {Record<string, string>} [extraEnv]
 * @param {{ fsImpl?: typeof fs, env?: NodeJS.ProcessEnv, homedir?: string }} [opts]
 * @returns {string}
 */
export function resolveAgyBinary(extraEnv = {}, opts = {}) {
  const fsImpl = opts.fsImpl ?? fs;
  const env = opts.env ?? process.env;
  const home = opts.homedir ?? os.homedir();

  const pathVar = extraEnv.PATH ?? env.PATH ?? '';
  const pathCandidates = pathVar
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map((dir) => path.join(dir, 'agy'));

  const candidates = [
    extraEnv.ANTIGRAVITY_BIN,
    extraEnv.AGY_BIN,
    env.ANTIGRAVITY_BIN,
    env.AGY_BIN,
    ...pathCandidates,
    path.join(home, '.gemini', 'bin', 'agy'),
    path.join(home, '.local', 'bin', 'agy'),
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
  ];

  const seen = new Set();
  for (const raw of candidates) {
    const candidate = typeof raw === 'string' ? raw.trim() : '';
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (isExecutableFile(candidate, fsImpl)) {
      return candidate;
    }
  }

  return 'agy';
}

/**
 * Build subprocess environment for `agy acp` from an agent_config row and user.
 *
 * @param {object | null | undefined} config
 * @param {object | null | undefined} [user]
 * @returns {Record<string, string | undefined>}
 */
export function buildAntigravityEnv(config, user = null) {
  const env = {
    ...stripServerEnv(process.env),
    ...parseExtraEnvJson(config?.extra_env_json),
  };
  delete env.GEMINI_API_KEY;
  const apiKey = typeof config?.api_key === 'string' ? config.api_key.trim() : '';
  if (apiKey) {
    env.GEMINI_API_KEY = apiKey;
  }
  if (user) {
    Object.assign(env, gitAuthorEnvFromUser(user));
  }
  return env;
}
