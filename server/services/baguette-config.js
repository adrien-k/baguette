import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import logger from '../logger.js';
import { resolveDataDirRelativePath } from '../config.js';
import { dockerContainerHostname } from './docker-session.js';

export const BAGUETTE_DIR = '.baguette';
export const CONFIG_FILENAME = '.baguette.yaml';
export const INSTRUCTIONS_REL_PATH = path.join(BAGUETTE_DIR, 'instructions.md');
export const SCRIPTS_REL_DIR = path.join(BAGUETTE_DIR, 'scripts');

function parseBaguetteConfigYaml(raw, sourceLabel) {
  const content = yaml.load(raw);
  if (content == null) return {};
  if (content.config != null && typeof content.config === 'object') return content.config;
  if (typeof content === 'object' && !Array.isArray(content)) return content;
  return { error: `Invalid ${sourceLabel}: expected a config object` };
}

/** Thrown when `.baguette.yaml` task definitions are invalid (callers map to HTTP 400). */
export class BaguetteConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BaguetteConfigError';
  }
}

/**
 * @param {string|null|undefined} worktreePath - Absolute path, or path relative to DATA_DIR (as stored on sessions).
 */
export async function loadBaguetteConfig(worktreePath) {
  const absoluteWorktreePath = resolveDataDirRelativePath(worktreePath);
  if (!absoluteWorktreePath) return null;
  const configPath = path.join(absoluteWorktreePath, CONFIG_FILENAME);
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8');
    const config = parseBaguetteConfigYaml(raw, CONFIG_FILENAME);
    if (config?.error) return config;
    return config;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    logger.error(err, 'Failed to load %s', CONFIG_FILENAME);
    return { error: `Failed to load ${CONFIG_FILENAME}: ${err.message}` };
  }
}

/**
 * Raw `.baguette.yaml` text for display (not parsed).
 * @returns {Promise<{ yaml: string } | { missing: true } | { error: string }>}
 */
export async function readBaguetteConfigRaw(worktreePath) {
  const absoluteWorktreePath = resolveDataDirRelativePath(worktreePath);
  if (!absoluteWorktreePath) return { missing: true };
  const configPath = path.join(absoluteWorktreePath, CONFIG_FILENAME);
  try {
    const yaml = await fs.promises.readFile(configPath, 'utf8');
    return { yaml };
  } catch (err) {
    if (err.code === 'ENOENT') return { missing: true };
    logger.error(err, 'Failed to read %s', CONFIG_FILENAME);
    return { error: `Failed to read ${CONFIG_FILENAME}: ${err.message}` };
  }
}

/**
 * Repository-specific agent instructions from `.baguette/instructions.md`.
 * @param {string|null|undefined} worktreePath
 * @returns {Promise<string|null>}
 */
export async function loadBaguetteInstructions(worktreePath) {
  const absoluteWorktreePath = resolveDataDirRelativePath(worktreePath);
  if (!absoluteWorktreePath) return null;
  const instructionsPath = path.join(absoluteWorktreePath, INSTRUCTIONS_REL_PATH);
  try {
    const text = await fs.promises.readFile(instructionsPath, 'utf8');
    const trimmed = text.trim();
    return trimmed || null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    logger.error(err, 'Failed to load %s', INSTRUCTIONS_REL_PATH);
    return null;
  }
}

const PLACEHOLDER_REGEX = /\$\{\{\s*baguette\.secrets\.([A-Za-z0-9_]+)\s*\}\}/g;
const SHORT_ID_REGEX = /\$\{\{\s*baguette\.session\.short_id\s*\}\}/g;
const PUBLIC_URI_REGEX = /\$\{\{\s*baguette\.session\.public_uri\s*\}\}/g;
const SERVICE_URI_REGEX = /\$\{\{\s*baguette\.services\.([A-Za-z0-9_-]+)\.public_uri\s*\}\}/g;
const TASK_ATTR_REGEX = /\$\{\{\s*baguette\.tasks\.([A-Za-z0-9_:-]+)\.([A-Za-z0-9_]+)\s*\}\}/g;
const TASK_PLACEHOLDER_SCAN_REGEX =
  /\$\{\{\s*baguette\.tasks\.([A-Za-z0-9_:-]+)\.([A-Za-z0-9_]+)\s*\}\}/g;

/** Thrown when session.env or task.env placeholders are invalid or cannot be resolved. */
export class TaskEnvInterpolationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TaskEnvInterpolationError';
  }
}

/** Collect `${{ baguette.tasks.<key>.<attr> }}` references from a config subtree. */
export function collectTaskPlaceholderRefs(value, refs = []) {
  if (typeof value === 'string') {
    const re = new RegExp(TASK_PLACEHOLDER_SCAN_REGEX.source, 'g');
    let match;
    while ((match = re.exec(value)) !== null) {
      refs.push({ taskKey: match[1], attr: match[2] });
    }
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTaskPlaceholderRefs(item, refs);
    return refs;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectTaskPlaceholderRefs(entry, refs);
  }
  return refs;
}

export function assertNoTaskPlaceholders(value, contextLabel) {
  const refs = collectTaskPlaceholderRefs(value);
  if (refs.length === 0) return;
  const { taskKey, attr } = refs[0];
  throw new TaskEnvInterpolationError(
    `${contextLabel} must not use task placeholders (found \${{ baguette.tasks.${taskKey}.${attr} }}). Put task-specific values in the task's own \`env\` block with \`depends-on\`.`
  );
}

/**
 * @param {Iterable<string>} configTaskKeys  keys from `session.tasks` / synthesized tasks
 * @param {Iterable<string>} [dependsOnKeys]  when set, each referenced task key must appear here
 */
export function assertTaskEnvReferencesValid(taskEnv, configTaskKeys, dependsOnKeys = null) {
  if (!taskEnv || typeof taskEnv !== 'object') return;
  const keys = configTaskKeys instanceof Set ? configTaskKeys : new Set(configTaskKeys);
  const deps =
    dependsOnKeys == null
      ? null
      : dependsOnKeys instanceof Set
        ? dependsOnKeys
        : new Set(dependsOnKeys);
  for (const { taskKey, attr } of collectTaskPlaceholderRefs(taskEnv)) {
    if (!keys.has(taskKey)) {
      throw new TaskEnvInterpolationError(
        `task.env references unknown task "${taskKey}" (\${{ baguette.tasks.${taskKey}.${attr} }}). Check the task key in .baguette.yaml.`
      );
    }
    if (deps && !deps.has(taskKey)) {
      throw new TaskEnvInterpolationError(
        `task.env references "${taskKey}" (\${{ baguette.tasks.${taskKey}.${attr} }}) but "${taskKey}" is not listed in depends-on. Add it to depends-on for this task.`
      );
    }
  }
}

export function assertNoRemainingTaskPlaceholders(value, contextLabel = 'task.env') {
  const refs = collectTaskPlaceholderRefs(value);
  if (refs.length === 0) return;
  const { taskKey, attr } = refs[0];
  throw new TaskEnvInterpolationError(
    `${contextLabel} placeholder \${{ baguette.tasks.${taskKey}.${attr} }} is not available — add "${taskKey}" to depends-on and wait for it to be ready.`
  );
}

/**
 * Resolve per-task `env` after depends-on: session-level placeholders, then injected task ports/hostnames.
 */
export function resolveTaskEnv(
  taskEnv,
  { interpolateOpts, portMap, configTaskKeys, dependsOnKeys }
) {
  if (!taskEnv || typeof taskEnv !== 'object' || Array.isArray(taskEnv)) return {};
  assertTaskEnvReferencesValid(taskEnv, configTaskKeys, dependsOnKeys ?? null);
  const withoutTaskHostnames = interpolateOpts ? { ...interpolateOpts, taskHostnames: {} } : null;
  let resolved = withoutTaskHostnames
    ? interpolateBaguetteConfig(taskEnv, withoutTaskHostnames)
    : { ...taskEnv };
  resolved = interpolateConfigTaskPorts(resolved, portMap ?? {});
  assertNoRemainingTaskPlaceholders(resolved);
  return resolved && typeof resolved === 'object' && !Array.isArray(resolved) ? resolved : {};
}

/** Hostnames for `type: docker` tasks on the session Docker network. */
export function buildDockerTaskHostnames(baguetteConfig, shortId) {
  const hostnames = {};
  const userTasks = baguetteConfig?.session?.tasks;
  if (!userTasks || typeof userTasks !== 'object' || Array.isArray(userTasks)) return hostnames;
  if (!shortId) return hostnames;
  for (const [key, val] of Object.entries(userTasks)) {
    if (val?.type === 'docker') hostnames[key] = dockerContainerHostname(shortId, key);
  }
  return hostnames;
}

export function interpolateString(
  str,
  { shortId, secrets, publicUri, servicesUriMap = {}, taskHostnames = {} }
) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(PLACEHOLDER_REGEX, (_, secretKey) => secrets[secretKey] ?? '')
    .replace(SHORT_ID_REGEX, shortId ?? '')
    .replace(PUBLIC_URI_REGEX, publicUri)
    .replace(SERVICE_URI_REGEX, (_, serviceName) => servicesUriMap[serviceName] ?? '')
    .replace(TASK_ATTR_REGEX, (match, taskKey, attr) => {
      if (attr === 'container_hostname') {
        const hostname = taskHostnames[taskKey];
        return hostname != null && hostname !== '' ? hostname : match;
      }
      // Host-port placeholders use the same pattern; resolved later via interpolateTaskPorts.
      return match;
    });
}

/** True if any string nested in a config value contains `needle` (default `${{`). */
export function configValueIncludesPlaceholder(value, needle = '${{') {
  if (typeof value === 'string') return value.includes(needle);
  if (Array.isArray(value)) {
    return value.some((item) => configValueIncludesPlaceholder(item, needle));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((v) => configValueIncludesPlaceholder(v, needle));
  }
  return false;
}

/**
 * Recursively apply `mapString` to every string in objects, arrays, or a lone string.
 */
export function deepMapStrings(value, mapString) {
  if (typeof value === 'string') return mapString(value);
  if (Array.isArray(value)) return value.map((item) => deepMapStrings(item, mapString));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = deepMapStrings(entry, mapString);
    }
    return out;
  }
  return value;
}

/**
 * Session-time substitution: secrets, short_id, public URIs, docker container_hostname.
 * Walks any config subtree (task env, container block, webserver, etc.).
 */
export function interpolateBaguetteConfig(value, opts) {
  if (!opts || value == null) return value;
  return deepMapStrings(value, (str) => {
    if (!str.includes('${{')) return str;
    return interpolateString(str, opts);
  });
}

export function interpolateEnv(template, opts) {
  if (!template || typeof template !== 'object' || Array.isArray(template)) return {};
  const result = interpolateBaguetteConfig(template, opts);
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

/** @deprecated Use interpolateBaguetteConfig — kept as a named alias for docker container blocks. */
export function interpolateDockerContainer(container, opts) {
  return interpolateBaguetteConfig(container, opts);
}

/**
 * Extract the webserver config from a host config.
 * Returns null if not defined.
 */
export function getWebserverConfig(baguetteConfig) {
  return baguetteConfig?.webserver ?? null;
}

/**
 * Normalize a script block from the config (`session.init`, `session.cleanup`, `tasks.*.run`).
 * Multi-line blocks are kept verbatim — Task writes them to a script file rather than
 * collapsing them into a single shell command.
 * Returns null if the block is empty or missing.
 */
export function getScriptBlock(block) {
  if (!block || typeof block !== 'string') return null;
  const trimmed = block.replace(/\s+$/, '');
  return trimmed.trim() ? trimmed : null;
}

/**
 * Append CLI arguments to a task's `run` script.
 * For multi-line scripts the args belong to the last command of the script, not to a
 * new line appended after it.
 */
export function appendTaskArgs(run, args) {
  if (!Array.isArray(args) || args.length === 0) return run;
  const suffix = args.join(' ').trim();
  if (!suffix) return run;
  if (!run.includes('\n')) return `${run} ${suffix}`.trim();

  const lines = run.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) {
      lines[i] = `${lines[i].replace(/\s+$/, '')} ${suffix}`;
      return lines.join('\n');
    }
  }
  return run;
}

const TASK_PORT_REGEX = /\$\{\{\s*baguette\.tasks\.([A-Za-z0-9_:-]+)\.([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Replace `${{ baguette.tasks.<taskKey>.<PORT_NAME> }}` placeholders with actual port numbers.
 * @param {string} commandStr
 * @param {Object<string, Object<string, number>>} taskPortMap  e.g. { 'dev-server': { PORT: 54321 } }
 * @returns {string}
 */
export function interpolateTaskPorts(commandStr, taskPortMap) {
  if (!commandStr || typeof commandStr !== 'string') return commandStr;
  return commandStr.replace(TASK_PORT_REGEX, (match, taskKey, portName) => {
    const value = taskPortMap?.[taskKey]?.[portName];
    if (value == null || value === '') return match;
    return String(value);
  });
}

/** After depends-on: replace `${{ baguette.tasks.<key>.<PORT> }}` with allocated host ports. */
export function interpolateConfigTaskPorts(value, taskPortMap) {
  if (value == null || !taskPortMap || Object.keys(taskPortMap).length === 0) return value;
  return deepMapStrings(value, (str) => {
    if (!str.includes('${{')) return str;
    return interpolateTaskPorts(str, taskPortMap);
  });
}

/** @deprecated Use interpolateConfigTaskPorts. */
export function interpolateDockerContainerTaskPorts(container, taskPortMap) {
  return interpolateConfigTaskPorts(container, taskPortMap);
}

/** @deprecated Use interpolateConfigTaskPorts. */
export function interpolateEnvTaskPorts(env, taskPortMap) {
  return interpolateConfigTaskPorts(env, taskPortMap);
}

/**
 * Build a tasks hash from a baguette config.
 * Returns `{ [taskKey]: { run, ports?, depends_on?, env?, attach?, internal? } }`.
 * `attach: false` means RunProjectCommand must not use attach mode (detached only).
 *
 * Supports both the new `session.tasks` hash format and the legacy `session.commands` array.
 * Synthesizes `baguette:init` from `session.init` if defined.
 */
export function getAvailableTasks(baguetteConfig) {
  const tasks = {};

  // Init task
  const initScript = getScriptBlock(baguetteConfig?.session?.init);
  if (initScript) tasks['baguette:init'] = { type: 'command', run: initScript };

  // User tasks: prefer `tasks` hash, fallback to `commands` array
  const userTasks = baguetteConfig?.session?.tasks;
  const userCommands = baguetteConfig?.session?.commands;
  if (userTasks && typeof userTasks === 'object' && !Array.isArray(userTasks)) {
    for (const [key, val] of Object.entries(userTasks)) {
      if (!val || typeof val !== 'object') continue;
      if (val.type === 'docker') {
        if (!val.container || typeof val.container !== 'object') continue;
        tasks[key] = {
          type: 'docker',
          container: val.container,
          ...(val['depends-on'] ? { depends_on: val['depends-on'] } : {}),
          ...(val.env && typeof val.env === 'object' ? { env: val.env } : {}),
          ...(val.attach === false ? { attach: false } : {}),
          ...(val.internal === true ? { internal: true } : {}),
        };
        continue;
      }
      if (typeof val.run !== 'string') continue;
      const run = getScriptBlock(val.run);
      if (!run) continue;
      tasks[key] = {
        type: 'command',
        run,
        ...(val.ports ? { ports: val.ports } : {}),
        ...(val['depends-on'] ? { depends_on: val['depends-on'] } : {}),
        ...(val.env && typeof val.env === 'object' ? { env: val.env } : {}),
        ...(val.attach === false ? { attach: false } : {}),
        ...(val.internal === true ? { internal: true } : {}),
      };
    }
  } else if (Array.isArray(userCommands)) {
    for (const cmd of userCommands) {
      if (cmd?.label && cmd?.run) {
        tasks[cmd.label] = {
          type: 'command',
          run: cmd.run,
          ...(cmd.ports ? { ports: cmd.ports } : {}),
          ...(cmd.attach === false ? { attach: false } : {}),
          ...(cmd.internal === true ? { internal: true } : {}),
        };
      }
    }
  }

  return tasks;
}

/**
 * Resolve the webserver block into an effective config.
 * Supports `webserver.task` (reference to a session task) XOR `webserver.command` (inline).
 * Returns `{ command, ports, expose, taskKey }` or null if no webserver is configured.
 */
export function resolveWebserverConfig(baguetteConfig) {
  const webserver = getWebserverConfig(baguetteConfig);
  if (!webserver) return null;

  if (webserver.task && webserver.command) {
    throw new Error('webserver.task and webserver.command are mutually exclusive');
  }

  if (webserver.task) {
    const tasks = getAvailableTasks(baguetteConfig);
    const taskDef = tasks[webserver.task];
    if (!taskDef) {
      throw new Error(`webserver.task "${webserver.task}" not found in session.tasks`);
    }
    return {
      command: taskDef.run,
      ports: taskDef.ports || [],
      expose: webserver.expose,
      taskKey: webserver.task,
      description: normalizeServiceDescription(webserver.description),
    };
  }

  if (webserver.command) {
    return {
      command: webserver.command,
      ports: webserver.ports || [],
      expose: webserver.expose,
      taskKey: null,
      description: normalizeServiceDescription(webserver.description),
    };
  }

  return null;
}

/**
 * Build the full list of available commands from a baguette config.
 * Backward-compatible wrapper around getAvailableTasks().
 * Returns an array of { label, run, ports?, attach? } (`attach: false` when attach mode is disallowed).
 */
export function getAvailableCommands(baguetteConfig) {
  const tasks = getAvailableTasks(baguetteConfig);
  return Object.entries(tasks)
    .filter(([_, t]) => t && !t.internal && (typeof t.run === 'string' || t.type === 'docker'))
    .map(([key, t]) => {
      if (t.type === 'docker') {
        return {
          label: key,
          type: 'docker',
          image: t.container?.image,
          ...(t.container?.build ? { build: t.container.build } : {}),
          ...(t.ports?.length ? { ports: t.ports } : {}),
          ...(t.attach === false ? { attach: false } : {}),
        };
      }
      return {
        label: key,
        run: t.run,
        ...(t.ports?.length ? { ports: t.ports } : {}),
        ...(t.attach === false ? { attach: false } : {}),
      };
    });
}

const SERVICE_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

/** Optional human-readable blurb for preview UIs (webserver / services blocks). */
export function normalizeServiceDescription(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Resolve the services block into an array of service configs.
 * Returns `Array<{ name, command, ports, expose, taskKey }>` or null if no services block.
 * Mutually exclusive with webserver block — throws if both are defined.
 */
export function resolveServicesConfig(baguetteConfig) {
  const servicesBlock = baguetteConfig?.services;
  if (!servicesBlock || typeof servicesBlock !== 'object') return null;

  if (baguetteConfig?.webserver) {
    throw new Error('services and webserver blocks are mutually exclusive');
  }

  const tasks = getAvailableTasks(baguetteConfig);
  const result = [];

  for (const [name, svcDef] of Object.entries(servicesBlock)) {
    if (!SERVICE_NAME_REGEX.test(name)) {
      throw new Error(`Invalid service name "${name}": must be lowercase alphanumeric + hyphens`);
    }
    if (name === 'vscode') {
      throw new Error(`Service name "vscode" is reserved by Baguette`);
    }
    if (!svcDef || typeof svcDef !== 'object') continue;

    if (!svcDef.task) {
      throw new Error(`services.${name} must specify a task`);
    }
    const taskDef = tasks[svcDef.task];
    if (!taskDef) {
      throw new Error(`services.${name}.task "${svcDef.task}" not found in session.tasks`);
    }
    result.push({
      name,
      command: taskDef.run,
      ports: taskDef.ports || [],
      expose: svcDef.expose,
      taskKey: svcDef.task,
      description: normalizeServiceDescription(svcDef.description),
    });
  }

  return result;
}
