import { describe, expect, it } from 'vitest';
import { parseShellToolResult } from '../shellToolResult.js';

describe('parseShellToolResult', () => {
  it('treats plain strings as stdout', () => {
    expect(parseShellToolResult('hello\nworld')).toEqual({
      exitCode: null,
      stdout: 'hello\nworld',
      stderr: '',
    });
  });

  it('reads stdout, stderr, and exit_code from JSON objects', () => {
    expect(parseShellToolResult({ stdout: 'out', stderr: 'err', exit_code: 2 })).toEqual({
      exitCode: 2,
      stdout: 'out',
      stderr: 'err',
    });
  });

  it('joins stdoutLines and reads exitCode', () => {
    expect(parseShellToolResult({ exitCode: 0, stdoutLines: ['line1', 'line2'] })).toEqual({
      exitCode: 0,
      stdout: 'line1\nline2',
      stderr: '',
    });
  });

  it('unwraps Cursor success payloads', () => {
    expect(
      parseShellToolResult({
        status: 'success',
        value: { exitCode: 1, stdout: 'x', stderr: 'y' },
      })
    ).toEqual({ exitCode: 1, stdout: 'x', stderr: 'y' });
  });

  it('maps Cursor error payloads to stderr', () => {
    expect(parseShellToolResult({ status: 'error', error: 'failed' })).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'failed',
    });
  });
});
