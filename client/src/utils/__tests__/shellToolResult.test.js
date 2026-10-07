import { describe, expect, it } from 'vitest';
import { parseShellToolResult, unwrapShellToolPayload } from '../shellToolResult.js';

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

  it('unwraps MCP content blocks with nested text', () => {
    const mcpData = {
      content: [
        {
          text: {
            text: JSON.stringify({
              ok: true,
              exitCode: 0,
              stdoutLines: ['done'],
              stderrLines: ['$ pnpm test'],
            }),
          },
        },
      ],
      isError: false,
    };
    expect(parseShellToolResult(mcpData)).toEqual({
      exitCode: 0,
      stdout: 'done',
      stderr: '$ pnpm test',
    });
  });

  it('unwraps typed mcp tool result data field', () => {
    const payload = unwrapShellToolPayload({
      status: 'ok',
      content: JSON.stringify({
        content: [{ text: { text: '{"exitCode":2,"stdoutLines":["x"],"stderrLines":[]}' } }],
      }),
      data: {
        content: [{ text: { text: '{"exitCode":2,"stdoutLines":["x"],"stderrLines":[]}' } }],
      },
    });
    expect(payload).toEqual({ exitCode: 2, stdoutLines: ['x'], stderrLines: [] });
  });
});
