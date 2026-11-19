import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function spawnLoadConfig(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baguette-config-test-'));
  const script = `
    process.env.NODE_ENV = 'production';
    process.env.DATA_DIR = ${JSON.stringify(dataDir)};
    await import(\`./server/config.js\`);
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'production', DATA_DIR: dataDir, ...extraEnv },
  });
}

describe('public URL env in production', () => {
  it('refuses to load config when NODE_ENV=production and neither PUBLIC_HOST nor DOMAIN is set', () => {
    const result = spawnLoadConfig({ DOMAIN: '', PUBLIC_HOST: '' });
    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toMatch(/PUBLIC_HOST|DOMAIN/);
  });

  it('loads config when NODE_ENV=production and only PUBLIC_HOST is set', () => {
    const result = spawnLoadConfig({
      DOMAIN: '',
      PUBLIC_HOST: 'https://baguette.example.com',
    });
    expect(result.status).toBe(0);
  });
});
