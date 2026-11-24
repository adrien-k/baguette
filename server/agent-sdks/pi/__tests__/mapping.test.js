import { describe, expect, it } from 'vitest';
import {
  mapPiAssistantMessageThinkingBackfill,
  mapPiEvent,
  mapPiToolArgs,
  mapPiToolResult,
  piBuildToolCallStart,
  piBuildToolCallComplete,
} from '../mapping.ts';

describe('mapPiEvent', () => {
  it('maps thinking_delta to assistant_thinking', () => {
    const ops = mapPiEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'pondering…' },
    });
    expect(ops).toEqual([{ op: 'assistant_thinking', text: 'pondering…' }]);
  });

  it('backfills thinking blocks from a final assistant message', () => {
    const ops = mapPiAssistantMessageThinkingBackfill({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'step one' },
        { type: 'text', text: 'THINK_OK' },
      ],
    });
    expect(ops).toEqual([{ op: 'assistant_thinking', text: 'step one' }]);
  });

  it('maps agent_settled to ok turn_result', () => {
    const ops = mapPiEvent({ type: 'agent_settled' });
    expect(ops).toEqual([
      {
        op: 'turn_result',
        payload: {
          type: 'turn_result',
          status: 'ok',
          error_message: null,
          total_cost_usd: 0,
        },
      },
    ]);
  });

  it('maps auto_retry_end failure to error turn_result', () => {
    const ops = mapPiEvent({
      type: 'auto_retry_end',
      success: false,
      finalError: '402: Insufficient account funds',
    });
    expect(ops).toEqual([
      {
        op: 'turn_result',
        payload: {
          type: 'turn_result',
          status: 'error',
          error_message: '402: Insufficient account funds',
          total_cost_usd: 0,
        },
      },
    ]);
  });

  it('ignores auto_retry_end success', () => {
    expect(mapPiEvent({ type: 'auto_retry_end', success: true })).toBeNull();
  });

  it('maps Pi edit args with edits[] for diff-from-result display', () => {
    const args = mapPiToolArgs('edit', 'edit', {
      path: 'src/foo.ts',
      edits: [{ oldText: 'a', newText: 'b' }],
    });
    expect(args).toEqual({
      path: 'src/foo.ts',
      old_string: null,
      new_string: null,
    });
  });

  it('extracts edit diff from Pi tool result details', () => {
    const result = mapPiToolResult('edit', {
      content: [{ type: 'text', text: 'ok' }],
      details: { diff: '-old\n+new' },
    });
    expect(result).toMatchObject({ status: 'ok', diff: '-old\n+new' });
  });

  it('unwraps the Pi bash result envelope into exit_code and stdout', () => {
    const result = mapPiToolResult('bash', {
      content: [{ type: 'text', text: 'some-output' }],
      structuredContent: {
        output: 'some-output\n',
        truncated: false,
        exit_code: 0,
        wall_time_seconds: 0.1,
      },
      isError: false,
    });
    expect(result).toEqual({
      status: 'ok',
      error_message: null,
      exit_code: 0,
      stdout: 'some-output\n',
      stderr: '',
    });
  });

  it('marks failed Pi bash calls as errors with a non-zero exit code', () => {
    const result = mapPiToolResult(
      'bash',
      {
        content: [{ type: 'text', text: 'fatal: not a git repository' }],
        structuredContent: {
          output: 'fatal: not a git repository',
          truncated: false,
          exit_code: 128,
          wall_time_seconds: 0.05,
        },
        isError: true,
      },
      { isError: true }
    );
    expect(result).toEqual({
      status: 'error',
      error_message: 'fatal: not a git repository',
      exit_code: 128,
      stdout: 'fatal: not a git repository',
      stderr: '',
    });
  });

  it('falls back to exit code 1 when a failed Pi bash call reports no exit_code', () => {
    const result = mapPiToolResult(
      'bash',
      {
        content: [{ type: 'text', text: 'boom' }],
        isError: true,
      },
      { isError: true }
    );
    expect(result).toMatchObject({ status: 'error', exit_code: 1, stdout: 'boom' });
  });

  it('builds typed tool_call payloads for the message writer', () => {
    const start = piBuildToolCallStart(
      'call-1',
      'bash',
      { command: 'pwd' },
      '2026-01-01T00:00:00Z'
    );
    expect(start.type).toBe('tool_call');
    expect(start.id).toBe('call-1');
    expect(start.name).toBe('Bash');
    const done = piBuildToolCallComplete(start, { rawResult: 'ok' });
    expect(done.type).toBe('tool_call');
    expect(done.status).toBe('completed');
    expect(done.result).toMatchObject({ status: 'ok', stdout: 'ok', exit_code: 0 });
  });

  it('maps Pi bash structuredContent into typed stdout', () => {
    const result = mapPiToolResult('bash', {
      content: [{ type: 'text', text: 'baguette_sdk_live_bash_stdout' }],
      structuredContent: {
        output: 'baguette_sdk_live_bash_stdout\n',
        exit_code: 0,
        truncated: false,
        wall_time_seconds: 0.1,
      },
    });
    expect(result).toMatchObject({
      status: 'ok',
      exit_code: 0,
      stdout: 'baguette_sdk_live_bash_stdout\n',
    });
  });

  it('maps Pi bash content text blocks when structuredContent is absent', () => {
    const result = mapPiToolResult('bash', {
      content: [{ type: 'text', text: 'hello pi\n' }],
      details: {},
    });
    expect(result).toMatchObject({ status: 'ok', exit_code: 0, stdout: 'hello pi\n' });
  });

  it('strips Pi non-zero exit suffix from bash content text', () => {
    const result = mapPiToolResult(
      'bash',
      {
        content: [{ type: 'text', text: 'warn\n\nCommand exited with code 2' }],
        details: {},
      },
      { isError: true }
    );
    expect(result).toMatchObject({ status: 'error', exit_code: 2, stdout: 'warn' });
  });

  it('completes Pi edit tool calls with stored diff', () => {
    const start = piBuildToolCallStart('call-edit', 'edit', {
      path: 'x.js',
      edits: [{ oldText: '1', newText: '2' }],
    });
    const done = piBuildToolCallComplete(start, {
      rawResult: {
        content: [{ type: 'text', text: 'done' }],
        details: { diff: '-1\n+2' },
      },
    });
    expect(done.args).toEqual({ path: 'x.js', old_string: null, new_string: null });
    expect(done.result).toMatchObject({ diff: '-1\n+2' });
  });
});
