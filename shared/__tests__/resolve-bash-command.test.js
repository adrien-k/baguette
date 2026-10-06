import { describe, it, expect } from 'vitest';
import { isBashToolName, resolveBashCommand } from '../resolve-bash-command.js';

describe('resolveBashCommand', () => {
  it('reads command from typed bash args', () => {
    expect(resolveBashCommand({ command: 'pnpm test' })).toBe('pnpm test');
  });

  it('reads command from generic args.input', () => {
    expect(
      resolveBashCommand({
        label: 'bash',
        detail: 'Run tests',
        input: { command: 'pnpm test', description: 'Run tests' },
      })
    ).toBe('pnpm test');
  });
});

describe('isBashToolName', () => {
  it('matches bash and shell case-insensitively', () => {
    expect(isBashToolName('bash')).toBe(true);
    expect(isBashToolName('Bash')).toBe(true);
    expect(isBashToolName('shell')).toBe(true);
    expect(isBashToolName('Read')).toBe(false);
  });
});
