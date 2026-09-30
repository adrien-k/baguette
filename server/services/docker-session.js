import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../logger.js';

const execFileAsync = promisify(execFile);

const DOCKER_TIMEOUT_MS = 120_000;

/** Created in bin/entrypoint.sh; session task containers join this network. */
export const BAGUETTE_DOCKER_NETWORK = 'baguette_default';

export function sessionVolumeName(shortId) {
  return `baguette_session_${shortId}`;
}

/** @param {string} spec e.g. "5432:PG_PORT" */
export function parseDockerPortMapping(spec) {
  const m = String(spec)
    .trim()
    .match(/^(\d+):([A-Za-z0-9_]+)$/);
  if (!m) {
    throw new Error(`Invalid docker task port "${spec}" (expected "<containerPort>:<PORT_LABEL>")`);
  }
  return { containerPort: Number(m[1]), hostEnv: m[2] };
}

/** Docker tasks: every `ports` entry must be `<containerPort>:<PORT_LABEL>`. */
export function parseDockerTaskPorts(ports) {
  if (!Array.isArray(ports) || ports.length === 0) {
    return { hostEnvVars: [], portMappings: [] };
  }
  const hostEnvVars = [];
  const portMappings = [];
  for (const entry of ports) {
    const m = parseDockerPortMapping(entry);
    hostEnvVars.push(m.hostEnv);
    portMappings.push(m);
  }
  return { hostEnvVars, portMappings };
}

export function parseDockerDuration(value, defaultMs = 5000) {
  if (value == null || value === '') return defaultMs;
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  const str = String(value).trim();
  const m = str.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!m) return defaultMs;
  const n = parseFloat(m[1]);
  switch ((m[2] || 's').toLowerCase()) {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 3600 * 1000;
    default:
      return n * 1000;
  }
}

/**
 * Normalize container block from .baguette.yaml.
 * @returns {{
 *   image: string,
 *   persist: string[],
 *   healthcheck: { test: string, intervalMs: number, timeoutMs: number, retries: number } | null,
 * }}
 */
export function normalizeDockerContainer(container) {
  if (!container || typeof container !== 'object') {
    throw new Error('docker task requires a container block');
  }
  if (!container.image || typeof container.image !== 'string') {
    throw new Error('container.image is required for docker tasks');
  }
  const persist = Array.isArray(container.persist)
    ? container.persist.filter((p) => typeof p === 'string' && p.trim())
    : [];

  let healthcheck = null;
  if (container.healthcheck && typeof container.healthcheck === 'object') {
    const test = container.healthcheck.test;
    let cmd = '';
    if (Array.isArray(test)) {
      if (test[0] === 'CMD-SHELL' && test[1]) cmd = String(test[1]);
      else if (test[0] === 'CMD') cmd = test.slice(1).join(' ');
      else cmd = test.join(' ');
    } else if (typeof test === 'string') {
      cmd = test;
    }
    if (cmd) {
      healthcheck = {
        test: cmd,
        intervalMs: parseDockerDuration(container.healthcheck.interval, 5000),
        timeoutMs: parseDockerDuration(container.healthcheck.timeout, 3000),
        retries: Number(container.healthcheck.retries ?? 10),
      };
    }
  }

  return {
    image: container.image.trim(),
    persist,
    healthcheck,
  };
}

export function dockerContainerName(shortId, taskKey) {
  const safe = String(taskKey).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `baguette_${shortId}_${safe}`.slice(0, 128);
}

/** DNS name for the container on `baguette_default` (same as container name). */
export function dockerContainerHostname(shortId, taskKey) {
  return dockerContainerName(shortId, taskKey);
}

export async function ensureBaguetteDockerNetwork() {
  try {
    await execFileAsync('docker', ['network', 'inspect', BAGUETTE_DOCKER_NETWORK], {
      timeout: DOCKER_TIMEOUT_MS,
    });
  } catch {
    await execFileAsync('docker', ['network', 'create', BAGUETTE_DOCKER_NETWORK], {
      timeout: DOCKER_TIMEOUT_MS,
    });
  }
}

export async function ensureSessionVolume(shortId) {
  const name = sessionVolumeName(shortId);
  try {
    await execFileAsync('docker', ['volume', 'inspect', name], { timeout: DOCKER_TIMEOUT_MS });
  } catch {
    await execFileAsync('docker', ['volume', 'create', name], { timeout: DOCKER_TIMEOUT_MS });
  }
  return name;
}

/**
 * @param {object} opts
 * @param {string} opts.shortId
 * @param {string} opts.taskKey
 * @param {ReturnType<typeof normalizeDockerContainer>} opts.container
 * @param {string[]} opts.taskEnvKeys  keys from task.env to pass as container -e flags
 * @param {Record<string, string>} opts.env  merged task env (values for taskEnvKeys)
 */
export async function startDockerContainer({
  shortId,
  taskKey,
  container,
  taskEnvKeys = [],
  env = {},
}) {
  await ensureBaguetteDockerNetwork();
  const volumeName = await ensureSessionVolume(shortId);
  const name = dockerContainerName(shortId, taskKey);
  const hostname = dockerContainerHostname(shortId, taskKey);

  await execFileAsync('docker', ['rm', '-f', name], { timeout: DOCKER_TIMEOUT_MS }).catch(() => {});

  const args = [
    'run',
    '-d',
    '--network',
    BAGUETTE_DOCKER_NETWORK,
    '--name',
    name,
    '--hostname',
    hostname,
    '--network-alias',
    hostname,
    '--label',
    `baguette.session.short_id=${shortId}`,
    '--label',
    `baguette.task=${taskKey}`,
  ];

  for (const path of container.persist) {
    args.push('-v', `${volumeName}:${path}`);
  }

  for (const key of taskEnvKeys) {
    const value = env[key];
    if (value == null || value === '') continue;
    args.push('-e', `${key}=${value}`);
  }

  if (container.healthcheck) {
    const hc = container.healthcheck;
    args.push(
      '--health-cmd',
      hc.test,
      '--health-interval',
      `${Math.max(1, Math.round(hc.intervalMs / 1000))}s`,
      '--health-timeout',
      `${Math.max(1, Math.round(hc.timeoutMs / 1000))}s`,
      '--health-retries',
      String(hc.retries)
    );
  }

  args.push(container.image);

  const { stdout } = await execFileAsync('docker', args, { timeout: DOCKER_TIMEOUT_MS });
  const containerId = stdout.trim();
  return { containerId, containerName: name };
}

export async function inspectContainerHealth(containerName) {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'inspect',
        '--format',
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
        containerName,
      ],
      { timeout: 15_000 }
    );
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

export async function isContainerRunning(containerName) {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['inspect', '--format', '{{.State.Running}}', containerName],
      { timeout: 15_000 }
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Wait until health is healthy or retries exhausted, or until timeoutMs.
 */
export async function waitForContainerHealth(containerName, { timeoutMs, pollMs = 500 } = {}) {
  const deadline = Date.now() + (timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    const status = await inspectContainerHealth(containerName);
    if (status === 'healthy') return;
    if (status === 'unhealthy') {
      throw new Error(`Container ${containerName} reported unhealthy`);
    }
    if (!(await isContainerRunning(containerName))) {
      throw new Error(`Container ${containerName} exited before becoming healthy`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Container ${containerName} health check timed out after ${timeoutMs}ms`);
}

export async function stopDockerContainer(containerName) {
  await execFileAsync('docker', ['rm', '-f', containerName], { timeout: DOCKER_TIMEOUT_MS }).catch(
    (err) => {
      logger.warn({ err: err.message, containerName }, 'docker rm failed');
    }
  );
}

/** Stop session containers and remove the session data volume. */
export async function removeSessionDockerResources(shortId) {
  if (!shortId) return;
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['ps', '-aq', '--filter', `label=baguette.session.short_id=${shortId}`],
      { timeout: DOCKER_TIMEOUT_MS }
    );
    const ids = stdout.trim().split('\n').filter(Boolean);
    if (ids.length) {
      await execFileAsync('docker', ['rm', '-f', ...ids], { timeout: DOCKER_TIMEOUT_MS });
    }
  } catch (err) {
    logger.warn({ err: err.message, shortId }, 'Failed to remove session docker containers');
  }

  const volume = sessionVolumeName(shortId);
  try {
    await execFileAsync('docker', ['volume', 'rm', volume], { timeout: DOCKER_TIMEOUT_MS });
  } catch (err) {
    if (err.code !== 1) {
      logger.warn({ err: err.message, shortId, volume }, 'Failed to remove session docker volume');
    }
  }
}
