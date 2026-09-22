/**
 * Unit tests for the .baguette.yaml script-block helpers.
 */
import { describe, it, expect } from 'vitest';
import { getScriptBlock, appendTaskArgs, getAvailableTasks } from '../baguette-config.js';

describe('getScriptBlock', () => {
  it('keeps a multi-line block intact instead of joining lines with &&', () => {
    const block = 'pnpm install:all\npnpm run migrate';
    expect(getScriptBlock(block)).toBe('pnpm install:all\npnpm run migrate');
  });

  it('preserves indentation so shell control flow survives', () => {
    const block = 'if [ -f .env ]; then\n  echo found\nfi';
    expect(getScriptBlock(block)).toBe(block);
  });

  it('strips trailing whitespace left by the YAML block scalar', () => {
    expect(getScriptBlock('pnpm test\n\n')).toBe('pnpm test');
  });

  it('returns null for empty, blank or non-string input', () => {
    expect(getScriptBlock('')).toBeNull();
    expect(getScriptBlock('   \n  ')).toBeNull();
    expect(getScriptBlock(null)).toBeNull();
    expect(getScriptBlock(undefined)).toBeNull();
    expect(getScriptBlock(42)).toBeNull();
  });
});

describe('appendTaskArgs', () => {
  it('appends args to a single-line command', () => {
    expect(appendTaskArgs('vitest run', ['src/foo.test.js'])).toBe('vitest run src/foo.test.js');
  });

  it('appends args to the last command of a multi-line script, not after it', () => {
    expect(appendTaskArgs('export CI=1\nvitest run', ['-t', 'my test'])).toBe(
      'export CI=1\nvitest run -t my test'
    );
  });

  it('ignores trailing blank lines when finding the last command', () => {
    expect(appendTaskArgs('vitest run\n\n', ['--bail'])).toBe('vitest run --bail\n\n');
  });

  it('returns the script unchanged when there are no args', () => {
    expect(appendTaskArgs('npm test', [])).toBe('npm test');
    expect(appendTaskArgs('npm test', undefined)).toBe('npm test');
    expect(appendTaskArgs('npm test', ['  '])).toBe('npm test');
  });
});

describe('getAvailableTasks', () => {
  it('exposes session.init as a multi-line baguette:init task', () => {
    const tasks = getAvailableTasks({
      session: { init: 'pnpm install:all\npnpm run migrate\n' },
    });
    expect(tasks['baguette:init'].run).toBe('pnpm install:all\npnpm run migrate');
  });

  it('keeps a multi-line task run block intact', () => {
    const tasks = getAvailableTasks({
      session: { tasks: { seed: { run: 'rm -f db.sqlite\npnpm run migrate\n' } } },
    });
    expect(tasks.seed.run).toBe('rm -f db.sqlite\npnpm run migrate');
  });

  it('skips tasks whose run block is blank', () => {
    const tasks = getAvailableTasks({ session: { tasks: { noop: { run: '  \n ' } } } });
    expect(tasks.noop).toBeUndefined();
  });
});
