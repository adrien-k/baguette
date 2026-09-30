import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseDockerPortMapping,
  parseDockerTaskPorts,
  parseDockerDuration,
  normalizeDockerContainer,
  normalizeDockerCommand,
  normalizeDockerBuild,
  resolveDockerBuildPaths,
  sessionVolumeName,
  dockerContainerName,
  dockerBuildImageTag,
  sessionBuiltImageRepositoryPrefix,
  isSessionBuiltImageRepository,
  waitForContainerHealth,
} from '../docker-session.js';

describe('docker-session helpers', () => {
  it('sessionVolumeName includes short id', () => {
    expect(sessionVolumeName('a3de4')).toBe('baguette_session_a3de4');
  });

  it('parseDockerTaskPorts rejects bare port labels', () => {
    expect(() => parseDockerTaskPorts(['PG_PORT'])).toThrow(/Invalid docker task port/);
  });

  it('parseDockerPortMapping', () => {
    expect(parseDockerPortMapping('5432:PG_PORT')).toEqual({
      containerPort: 5432,
      hostEnv: 'PG_PORT',
    });
  });

  it('parseDockerDuration', () => {
    expect(parseDockerDuration('5s')).toBe(5000);
    expect(parseDockerDuration('500ms')).toBe(500);
  });

  it('normalizeDockerCommand accepts argv list or shell string', () => {
    expect(normalizeDockerCommand(['redis-server', '--save', '60'])).toEqual([
      'redis-server',
      '--save',
      '60',
    ]);
    expect(normalizeDockerCommand('redis-server --save 60')).toEqual([
      'sh',
      '-c',
      'redis-server --save 60',
    ]);
    expect(normalizeDockerCommand('  ')).toBeNull();
  });

  it('normalizeDockerContainer parses command', () => {
    const c = normalizeDockerContainer({
      image: 'redis:7',
      command: ['redis-server', '--appendonly', 'yes'],
    });
    expect(c.command).toEqual(['redis-server', '--appendonly', 'yes']);
  });

  it('normalizeDockerContainer parses healthcheck', () => {
    const c = normalizeDockerContainer({
      image: 'postgres:16',
      persist: ['/data'],
      healthcheck: {
        test: ['CMD-SHELL', 'pg_isready'],
        interval: '5s',
        timeout: '3s',
        retries: 3,
      },
    });
    expect(c.image).toBe('postgres:16');
    expect(c.build).toBeNull();
    expect(c.healthcheck.test).toBe('pg_isready');
    expect(c.healthcheck.retries).toBe(3);
  });

  it('normalizeDockerContainer accepts build instead of image', () => {
    const c = normalizeDockerContainer({
      build: {
        context: '.',
        dockerfile: 'Dockerfile.dev',
        args: { NODE_ENV: 'development' },
        target: 'runtime',
      },
    });
    expect(c.image).toBeNull();
    expect(c.build).toEqual({
      context: '.',
      dockerfile: 'Dockerfile.dev',
      args: { NODE_ENV: 'development' },
      target: 'runtime',
    });
  });

  it('normalizeDockerBuild accepts string context', () => {
    expect(normalizeDockerBuild('./docker')).toEqual({
      context: './docker',
      dockerfile: null,
      args: {},
      target: null,
    });
  });

  it('resolveDockerBuildPaths resolves relative paths from worktree', () => {
    const build = normalizeDockerBuild({ context: 'docker', dockerfile: 'app/Dockerfile' });
    const { context, dockerfile } = resolveDockerBuildPaths(build, '/repo/worktree');
    expect(context).toBe('/repo/worktree/docker');
    expect(dockerfile).toBe('/repo/worktree/docker/app/Dockerfile');
  });

  it('dockerBuildImageTag matches container name', () => {
    expect(dockerBuildImageTag('abcd', 'postgres')).toBe(dockerContainerName('abcd', 'postgres'));
  });

  it('isSessionBuiltImageRepository matches default session build tags only', () => {
    expect(sessionBuiltImageRepositoryPrefix('a3de4')).toBe('baguette_a3de4_');
    expect(isSessionBuiltImageRepository('baguette_a3de4_api', 'a3de4')).toBe(true);
    expect(isSessionBuiltImageRepository('postgres', 'a3de4')).toBe(false);
    expect(isSessionBuiltImageRepository('myapp', 'a3de4')).toBe(false);
  });

  it('normalizeDockerContainer requires image or build', () => {
    expect(() => normalizeDockerContainer({ persist: ['/data'] })).toThrow(
      /image or container.build/
    );
  });

  it('dockerContainerName sanitizes task keys', () => {
    expect(dockerContainerName('abcd', 'baguette:init')).toMatch(/^baguette_abcd_/);
  });
});

describe('waitForContainerHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps polling while the container record is missing (foreground docker run race)', async () => {
    vi.useFakeTimers();
    const inspectHealth = vi
      .fn()
      .mockResolvedValueOnce('starting')
      .mockResolvedValueOnce('starting')
      .mockResolvedValue('healthy');
    const inspectState = vi.fn().mockResolvedValue('missing');

    const ready = waitForContainerHealth('baguette_abcd_redis', {
      timeoutMs: 10_000,
      pollMs: 100,
      inspectHealth,
      inspectState,
    });
    await vi.advanceTimersByTimeAsync(250);
    await expect(ready).resolves.toBeUndefined();
    expect(inspectHealth).toHaveBeenCalledTimes(3);
  });

  it('fails when the container process has exited', async () => {
    const inspectHealth = vi.fn().mockResolvedValue('starting');
    const inspectState = vi.fn().mockResolvedValue('exited');

    await expect(
      waitForContainerHealth('baguette_abcd_redis', {
        timeoutMs: 5_000,
        pollMs: 100,
        inspectHealth,
        inspectState,
      })
    ).rejects.toThrow(/exited before becoming healthy/);
  });
});
