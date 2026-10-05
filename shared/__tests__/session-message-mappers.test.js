import { describe, it, expect } from 'vitest';
import {
  mapBashToolResult,
  buildToolCallStart,
  buildToolCallComplete,
} from '../session-message-mappers.js';

describe('session-message-mappers', () => {
  it('maps bash exit code and streams', () => {
    const r = mapBashToolResult({ exitCode: 2, stdout: 'ok', stderr: 'warn' });
    expect(r).toEqual({ exit_code: 2, stdout: 'ok', stderr: 'warn' });
  });

  it('completes tool call with bash result', () => {
    const start = buildToolCallStart('id-1', 'Bash', { command: 'echo hi' });
    const done = buildToolCallComplete(start, {
      rawResult: { exitCode: 0, stdout: 'hi\n', stderr: '' },
    });
    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ exit_code: 0, stdout: 'hi\n', stderr: '' });
    expect(done.result).not.toBeNull();
  });

  it('leaves result null while running', () => {
    const start = buildToolCallStart('id-2', 'Read', { path: '/tmp/x' });
    expect(start.status).toBe('running');
    expect(start.result).toBeNull();
  });
});
