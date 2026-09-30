import { describe, it, expect } from 'vitest';
import {
  parseDockerPortMapping,
  parseDockerTaskPorts,
  parseDockerDuration,
  normalizeDockerContainer,
  sessionVolumeName,
  dockerContainerName,
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
    expect(c.healthcheck.test).toBe('pg_isready');
    expect(c.healthcheck.retries).toBe(3);
  });

  it('dockerContainerName sanitizes task keys', () => {
    expect(dockerContainerName('abcd', 'baguette:init')).toMatch(/^baguette_abcd_/);
  });
});
