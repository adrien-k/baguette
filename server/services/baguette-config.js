import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import logger from '../logger.js';
import { resolveDataDirRelativePath } from '../config.js';

const CONFIG_FILENAME = '.baguette.yaml';

/**
 * @param {string|null|undefined} worktreePath - Absolute path, or path relative to DATA_DIR (as stored on sessions).
 */
export async function loadBaguetteConfig(worktreePath) {
  const absoluteWorktreePath = resolveDataDirRelativePath(worktreePath);
  if (!absoluteWorktreePath) return null;
  const configPath = path.join(absoluteWorktreePath, CONFIG_FILENAME);
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8');
    const content = yaml.load(raw);
    return content.config ?? {};
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    logger.error(err, 'Failed to load %s', CONFIG_FILENAME);
    return { error: `Failed to load ${CONFIG_FILENAME}: ${err.message}` };
  }
}

const PLACEHOLDER_REGEX = /\$\{\{\s*baguette\.secrets\.([A-Za-z0-9_]+)\s*\}\}/g;
const SHORT_ID_REGEX = /\$\{\{\s*baguette\.session\.short_id\s*\}\}/g;
const PUBLIC_URI_REGEX = /\$\{\{\s*baguette\.session\.public_uri\s*\}\}/g;
const SERVICE_URI_REGEX = /\$\{\{\s*baguette\.services\.([A-Za-z0-9_-]+)\.public_uri\s*\}\}/g;

export function interpolateString(str, { shortId, secrets, publicUri, servicesUriMap = {} }) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(PLACEHOLDER_REGEX, (_, secretKey) => secrets[secretKey] ?? '')
    .replace(SHORT_ID_REGEX, shortId ?? '')
    .replace(PUBLIC_URI_REGEX, publicUri)
    .replace(SERVICE_URI_REGEX, (_, serviceName) => servicesUriMap[serviceName] ?? '');
}

export function interpolateEnv(template, opts) {
  if (!template || typeof template !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(template)) {
    if (typeof value !== 'string') continue;
    result[key] = interpolateString(value, opts);
  }
  return result;
}

/**
 * Extract the webserver config from a host config.
 * Returns null if not defined.
 */
export function getWebserverConfig(baguetteConfig) {
  return baguetteConfig?.webserver ?? null;
}

/**
 * Extract a multi-line script block as a single shell command (lines joined with &&).
 * Returns null if the block is empty or missing.
 */
export function getScriptCommand(block) {
  if (!block || typeof block !== 'string') return null;
  const lines = block
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  return lines.join(' && ');
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
  return commandStr.replace(TASK_PORT_REGEX, (_, taskKey, portName) => {
    return String(taskPortMap?.[taskKey]?.[portName] ?? '');
  });
}

/**
 * Build a tasks hash from a baguette config.
 * Returns `{ [taskKey]: { run, ports?, depends_on? } }`.
 *
 * Supports both the new `session.tasks` hash format and the legacy `session.commands` array.
 * Synthesizes `baguette:init` from `session.init` if defined.
 */
export function getAvailableTasks(baguetteConfig) {
  const tasks = {};

  // Init task
  const initScript = getScriptCommand(baguetteConfig?.session?.init);
  if (initScript) tasks['baguette:init'] = { run: initScript };

  // User tasks: prefer `tasks` hash, fallback to `commands` array
  const userTasks = baguetteConfig?.session?.tasks;
  const userCommands = baguetteConfig?.session?.commands;
  if (userTasks && typeof userTasks === 'object' && !Array.isArray(userTasks)) {
    for (const [key, val] of Object.entries(userTasks)) {
      if (!val || typeof val.run !== 'string') continue;
      tasks[key] = {
        run: val.run,
        ...(val.ports ? { ports: val.ports } : {}),
        ...(val['depends-on'] ? { depends_on: val['depends-on'] } : {}),
        ...(val.env && typeof val.env === 'object' ? { env: val.env } : {}),
      };
    }
  } else if (Array.isArray(userCommands)) {
    for (const cmd of userCommands) {
      if (cmd?.label && cmd?.run) {
        tasks[cmd.label] = { run: cmd.run, ...(cmd.ports ? { ports: cmd.ports } : {}) };
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
    };
  }

  if (webserver.command) {
    return {
      command: webserver.command,
      ports: webserver.ports || [],
      expose: webserver.expose,
      taskKey: null,
    };
  }

  return null;
}

/**
 * Build the full list of available commands from a baguette config.
 * Backward-compatible wrapper around getAvailableTasks().
 * Returns an array of { label, run, ports? }.
 */
export function getAvailableCommands(baguetteConfig) {
  const tasks = getAvailableTasks(baguetteConfig);
  return Object.entries(tasks)
    .filter(([_, t]) => t && typeof t.run === 'string')
    .map(([key, t]) => ({ label: key, run: t.run, ...(t.ports?.length ? { ports: t.ports } : {}) }));
}

const SERVICE_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

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
    });
  }

  return result;
}
