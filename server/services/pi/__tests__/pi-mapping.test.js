import { describe, expect, it } from 'vitest';
import {
  mapPiEvent,
  mapPiToolArgs,
  mapPiToolResult,
  piBuildToolCallStart,
  piBuildToolCallComplete,
} from '../pi-mapping.ts';

describe('mapPiEvent', () => {
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
