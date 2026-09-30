import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { isAbsolute, resolve } from 'path';
import logger from '../logger.js';

const execFileAsync = promisify(execFile);

const DOCKER_TIMEOUT_MS = 120_000;
const DOCKER_BUILD_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Run `docker` with streamed stdout/stderr. Rejects on non-zero exit.
 * @param {string[]} args docker CLI args (without `docker`)
 * @param {{ timeout?: number, onOutput?: (stream: 'stdout' | 'stderr', data: string) => void }} [opts]
 */
export function runDockerCommand(args, { timeout, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const append = (stream, chunk) => {
      const text = chunk.toString();
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      onOutput?.(stream, text);
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));

    let timer;
    if (timeout != null) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          Object.assign(new Error(`docker ${args[0]} timed out after ${timeout}ms`), {
            stdout,
            stderr,
          })
        );
      }, timeout);
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          Object.assign(new Error(`docker ${args[0]} failed with exit code ${code}`), {
            stdout,
            stderr,
            code,
          })
        );
      }
    });
  });
}

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
 * @returns {{ context: string, dockerfile: string | null, args: Record<string, string>, target: string | null } | null}
 */
export function normalizeDockerBuild(build) {
  if (build == null) return null;
  if (typeof build === 'string') {
    const context = build.trim();
    if (!context) throw new Error('container.build must be a non-empty path or object');
    return { context, dockerfile: null, args: {}, target: null };
  }
  if (typeof build !== 'object' || Array.isArray(build)) {
    throw new Error('container.build must be a path string or object with context');
  }
  const context = build.context;
  if (!context || typeof context !== 'string' || !String(context).trim()) {
    throw new Error('container.build.context is required');
  }
  const args = {};
  if (build.args && typeof build.args === 'object' && !Array.isArray(build.args)) {
    for (const [key, value] of Object.entries(build.args)) {
      if (value == null) continue;
      args[key] = String(value);
    }
  }
  const dockerfile =
    build.dockerfile != null && build.dockerfile !== '' ? String(build.dockerfile).trim() : null;
  const target = build.target != null && build.target !== '' ? String(build.target).trim() : null;
  return { context: String(context).trim(), dockerfile, args, target };
}

/** Resolve build context and dockerfile paths against the session worktree. */
export function resolveDockerBuildPaths(build, cwd) {
  const base = cwd && typeof cwd === 'string' ? cwd : process.cwd();
  const context = isAbsolute(build.context) ? build.context : resolve(base, build.context);
  let dockerfile = build.dockerfile;
  if (dockerfile) {
    dockerfile = isAbsolute(dockerfile) ? dockerfile : resolve(context, dockerfile);
  }
  return { context, dockerfile };
}

export function dockerBuildImageTag(shortId, taskKey) {
  return dockerContainerName(shortId, taskKey);
}

/** Repository name prefix for default session-built image tags (`baguette_<short_id>_<task>`). */
export function sessionBuiltImageRepositoryPrefix(shortId) {
  return `baguette_${shortId}_`;
}

export function isSessionBuiltImageRepository(repository, shortId) {
  return (
    typeof repository === 'string' &&
    repository.startsWith(sessionBuiltImageRepositoryPrefix(shortId))
  );
}

/**
 * @returns {string[] | null}
 */
export function normalizeDockerCommand(command) {
  if (command == null) return null;
  if (Array.isArray(command)) {
    const parts = command
      .filter((part) => part != null && String(part).trim() !== '')
      .map((part) => String(part));
    return parts.length ? parts : null;
  }
  if (typeof command === 'string') {
    const trimmed = command.trim();
    if (!trimmed) return null;
    return ['sh', '-c', trimmed];
  }
  throw new Error('container.command must be a string or array of strings');
}

/**
 * Normalize container block from .baguette.yaml.
 * @returns {{
 *   image: string | null,
 *   build: ReturnType<typeof normalizeDockerBuild>,
 *   persist: string[],
 *   command: string[] | null,
 *   healthcheck: { test: string, intervalMs: number, timeoutMs: number, retries: number } | null,
 * }}
 */
export function normalizeDockerContainer(container) {
  if (!container || typeof container !== 'object') {
    throw new Error('docker task requires a container block');
  }
  const build = normalizeDockerBuild(container.build);
  const image =
    container.image != null && typeof container.image === 'string' && container.image.trim()
      ? container.image.trim()
      : null;
  if (!image && !build) {
    throw new Error('container.image or container.build is required for docker tasks');
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

  const command = normalizeDockerCommand(container.command);

  return {
    image,
    build,
    persist,
    command,
    healthcheck,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.shortId
 * @param {string} opts.taskKey
 * @param {NonNullable<ReturnType<typeof normalizeDockerBuild>>} opts.build
 * @param {string | null} [opts.imageTag]  optional tag; defaults to session/task name
 * @param {string} [opts.cwd]  session worktree for relative build.context
 */
export async function buildDockerImage({
  shortId,
  taskKey,
  build,
  imageTag = null,
  cwd,
  onOutput,
}) {
  const tag = imageTag || dockerBuildImageTag(shortId, taskKey);
  const { context, dockerfile } = resolveDockerBuildPaths(build, cwd);
  const args = [
    'build',
    '-t',
    tag,
    '--label',
    `baguette.session.short_id=${shortId}`,
    '--label',
    `baguette.task=${taskKey}`,
    '--label',
    'baguette.managed=session-image',
  ];
  if (dockerfile) args.push('-f', dockerfile);
  if (build.target) args.push('--target', build.target);
  for (const [key, value] of Object.entries(build.args)) {
    args.push('--build-arg', `${key}=${value}`);
  }
  args.push(context);
  await runDockerCommand(args, { timeout: DOCKER_BUILD_TIMEOUT_MS, onOutput });
  return tag;
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
export async function spawnDockerContainer({
  shortId,
  taskKey,
  container,
  taskEnvKeys = [],
  env = {},
}) {
  const image = container.image;
  if (!image) {
    throw new Error('docker container has no image to run');
  }
  await ensureBaguetteDockerNetwork();
  const volumeName = await ensureSessionVolume(shortId);
  const name = dockerContainerName(shortId, taskKey);
  const hostname = dockerContainerHostname(shortId, taskKey);

  await execFileAsync('docker', ['rm', '-f', name], { timeout: DOCKER_TIMEOUT_MS }).catch(() => {});

  const args = [
    'run',
    '--rm',
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

  args.push(image);
  if (container.command?.length) {
    args.push(...container.command);
  }

  const child = spawn('docker', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  return { child, containerName: name };
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

/** Docker State.Status, or `missing` when inspect fails (not created yet or already removed). */
export async function inspectContainerState(containerName) {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['inspect', '--format', '{{.State.Status}}', containerName],
      { timeout: 15_000 }
    );
    const status = stdout.trim();
    return status || 'unknown';
  } catch {
    return 'missing';
  }
}

/** Exit code from the container's main process after it has stopped (1 if unknown). */
export async function getContainerExitCode(containerName) {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['inspect', '--format', '{{.State.ExitCode}}', containerName],
      { timeout: 15_000 }
    );
    const code = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(code) ? code : 1;
  } catch {
    return 1;
  }
}

/**
 * Wait until health is healthy or retries exhausted, or until timeoutMs.
 * @param {{ inspectHealth?: typeof inspectContainerHealth, inspectState?: typeof inspectContainerState }} [opts]
 */
export async function waitForContainerHealth(
  containerName,
  {
    timeoutMs,
    pollMs = 500,
    inspectHealth = inspectContainerHealth,
    inspectState = inspectContainerState,
  } = {}
) {
  const deadline = Date.now() + (timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    const status = await inspectHealth(containerName);
    if (status === 'healthy') return;
    if (status === 'unhealthy') {
      throw new Error(`Container ${containerName} reported unhealthy`);
    }
    const state = await inspectState(containerName);
    if (state === 'exited' || state === 'dead') {
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

/** Image IDs for images built or tagged for this session (label or default `baguette_<short_id>_` repo). */
export async function listSessionDockerImageIds(shortId) {
  if (!shortId) return [];
  const ids = new Set();
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['images', '-q', '--filter', `label=baguette.session.short_id=${shortId}`],
      { timeout: DOCKER_TIMEOUT_MS }
    );
    for (const id of stdout.trim().split('\n').filter(Boolean)) ids.add(id);
  } catch (err) {
    logger.warn({ err: err.message, shortId }, 'Failed to list session docker images by label');
  }
  const prefix = sessionBuiltImageRepositoryPrefix(shortId);
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['images', '--format', '{{.ID}}\t{{.Repository}}'],
      { timeout: DOCKER_TIMEOUT_MS }
    );
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const [id, repository] = line.split('\t');
      if (repository?.startsWith(prefix) && id) ids.add(id);
    }
  } catch (err) {
    logger.warn({ err: err.message, shortId }, 'Failed to list session docker images by name');
  }
  return [...ids];
}

export async function removeSessionDockerImages(shortId) {
  if (!shortId) return;
  try {
    const ids = await listSessionDockerImageIds(shortId);
    if (ids.length) {
      await execFileAsync('docker', ['rmi', '-f', ...ids], { timeout: DOCKER_TIMEOUT_MS });
    }
  } catch (err) {
    logger.warn({ err: err.message, shortId }, 'Failed to remove session docker images');
  }
}

/** Stop session containers, remove built images, and remove the session data volume. */
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

  await removeSessionDockerImages(shortId);

  const volume = sessionVolumeName(shortId);
  try {
    await execFileAsync('docker', ['volume', 'rm', volume], { timeout: DOCKER_TIMEOUT_MS });
  } catch (err) {
    if (err.code !== 1) {
      logger.warn({ err: err.message, shortId, volume }, 'Failed to remove session docker volume');
    }
  }
}
