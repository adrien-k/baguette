import fs from 'fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getContainerUptimeSeconds, getRunningGitSha } from '../deployment-info.js';

describe('deployment-info', () => {
  const originalEnv = process.env.BAGUETTE_GIT_SHA;

  beforeEach(() => {
    delete process.env.BAGUETTE_GIT_SHA;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.BAGUETTE_GIT_SHA;
    else process.env.BAGUETTE_GIT_SHA = originalEnv;
    vi.restoreAllMocks();
  });

  it('getRunningGitSha prefers BAGUETTE_GIT_SHA', () => {
    process.env.BAGUETTE_GIT_SHA = 'abc123def456';
    expect(getRunningGitSha()).toBe('abc123def456');
  });

  it('getRunningGitSha falls back to git rev-parse', () => {
    const sha = getRunningGitSha();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('getContainerUptimeSeconds returns null outside Docker', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(getContainerUptimeSeconds()).toBeNull();
  });
});
