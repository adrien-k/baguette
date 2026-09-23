import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const clientDir = path.resolve(fileURLToPath(import.meta.url), '../../..');

describe('frontend build', () => {
  it('vite build succeeds (no unresolved imports)', () => {
    const result = spawnSync('npm', ['run', 'build'], {
      cwd: clientDir,
      encoding: 'utf-8',
      timeout: 120_000,
    });

    if (result.status !== 0) {
      throw new Error(`vite build failed:\n${result.stderr || result.stdout}`);
    }

    expect(result.status).toBe(0);

    const swPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/sw.js');
    const sw = readFileSync(swPath, 'utf-8');
    expect(sw).not.toMatch(/url:"index\.html"/);
    expect(sw).not.toContain('NavigationRoute');
  }, 120_000);
});
