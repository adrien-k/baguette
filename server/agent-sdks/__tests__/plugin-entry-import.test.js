import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');

const BUILT_IN_PLUGINS = ['claude', 'cursor', 'pi', 'mock'];

describe('built-in SDK plugin entry imports', () => {
  it.each(BUILT_IN_PLUGINS)(
    '%s/index.js loads as a fresh Node entry without import cycles',
    async (sdk) => {
      const modulePath = `./server/agent-sdks/${sdk}/index.js`;
      await expect(
        execFileAsync(
          process.execPath,
          ['--input-type=module', '-e', `await import(${JSON.stringify(modulePath)})`],
          { cwd: repoRoot, env: { ...process.env, NODE_ENV: 'test' } }
        )
      ).resolves.toBeDefined();
    }
  );
});
