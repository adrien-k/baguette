import { describe, expect, it } from 'vitest';
import {
  mapCursorEvent,
  unwrapCursorResult,
  canonicalizeCursorToolName,
  cursorCanonicalToolName,
  cursorToolKindFromName,
  mapCursorToolResult,
  mapCursorBashToolResult,
  mapCursorToolArgs,
  cursorBuildToolCallStart,
  cursorBuildToolCallComplete,
} from '../cursor-mapping.ts';

// Test fixtures cast through `unknown` — they exercise the mapper's runtime
// behaviour, not the SDK type surface.
const asCursor = (v) => /** @type {any} */ (v);

describe('mapCursorEvent', () => {
  it('maps assistant content to a text op', () => {
    expect(
      mapCursorEvent(
        asCursor({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })
      )
    ).toEqual([{ op: 'assistant_text', text: 'hi' }]);
  });

  it('maps a running tool_call to tool_start', () => {
    expect(
      mapCursorEvent(
        asCursor({
          type: 'tool_call',
          status: 'running',
          call_id: 'c1',
          name: 'read',
          args: { path: '/a' },
        })
      )
    ).toEqual([{ op: 'tool_start', call_id: 'c1', name: 'Read', input: { path: '/a' } }]);
  });

  it('maps a completed tool_call to tool_result and unwraps the Cursor envelope', () => {
    const ops = mapCursorEvent(
      asCursor({
        type: 'tool_call',
        status: 'completed',
        call_id: 'c1',
        name: 'shell',
        result: { status: 'success', value: { exitCode: 0, stdout: 'ok' } },
      })
    );
    expect(ops[0]).toMatchObject({
      op: 'tool_result',
      call_id: 'c1',
      name: 'Bash',
      raw: { exitCode: 0, stdout: 'ok' },
      is_error: false,
      status: 'completed',
    });
  });

  it('marks an errored tool_call', () => {
    const ops = mapCursorEvent(
      asCursor({ type: 'tool_call', status: 'error', call_id: 'c', name: 'read' })
    );
    expect(ops[0]).toMatchObject({ is_error: true, status: 'error' });
  });

  it('emits no row for a running plan tool but a plan op when complete', () => {
    expect(
      mapCursorEvent(
        asCursor({ type: 'tool_call', status: 'running', name: 'createPlan', args: {} })
      )
    ).toBeNull();
    expect(
      mapCursorEvent(
        asCursor({
          type: 'tool_call',
          status: 'completed',
          name: 'createPlan',
          args: { plan: '# P' },
        })
      )
    ).toEqual([{ op: 'plan', markdown: '# P' }]);
  });

  it('produces no rows for usage and status events', () => {
    expect(mapCursorEvent(asCursor({ type: 'usage' }))).toBeNull();
    expect(mapCursorEvent(asCursor({ type: 'status', status: 'FINISHED' }))).toBeNull();
  });

  it('emits tool_progress for a running Task with conversationSteps', () => {
    const ops = mapCursorEvent(
      asCursor({
        type: 'tool_call',
        status: 'running',
        call_id: 'sub-1',
        name: 'task',
        args: { description: 'Explore' },
        result: {
          status: 'success',
          value: {
            conversationSteps: [{ assistantMessage: { text: 'Scanning repo.' } }],
          },
        },
      })
    );
    expect(ops).toEqual([
      { op: 'tool_start', call_id: 'sub-1', name: 'Task', input: { description: 'Explore' } },
      {
        op: 'tool_progress',
        call_id: 'sub-1',
        raw: { conversationSteps: [{ assistantMessage: { text: 'Scanning repo.' } }] },
      },
    ]);
  });
});

describe('unwrapCursorResult', () => {
  it('unwraps a success envelope and leaves anything else alone', () => {
    expect(unwrapCursorResult({ status: 'success', value: { a: 1 } })).toEqual({ a: 1 });
    expect(unwrapCursorResult({ a: 1 })).toEqual({ a: 1 });
    expect(unwrapCursorResult('raw')).toBe('raw');
  });
});

describe('canonicalizeCursorToolName', () => {
  it('translates Cursor snake_case names to canonical PascalCase', () => {
    expect(canonicalizeCursorToolName('shell')).toBe('Bash');
    expect(canonicalizeCursorToolName('read')).toBe('Read');
    expect(canonicalizeCursorToolName('write')).toBe('Write');
    expect(canonicalizeCursorToolName('edit')).toBe('Edit');
    expect(canonicalizeCursorToolName('glob')).toBe('Glob');
    expect(canonicalizeCursorToolName('grep')).toBe('Grep');
    expect(canonicalizeCursorToolName('task')).toBe('Task');
    expect(canonicalizeCursorToolName('delete')).toBe('Delete');
  });

  it('passes MCP names through verbatim', () => {
    expect(canonicalizeCursorToolName('mcp__baguette__create_issue')).toBe(
      'mcp__baguette__create_issue'
    );
  });
});

describe('cursorCanonicalToolName', () => {
  it('returns "generic" for empty input', () => {
    expect(cursorCanonicalToolName('')).toBe('generic');
    expect(cursorCanonicalToolName(null)).toBe('generic');
    expect(cursorCanonicalToolName(undefined)).toBe('generic');
  });
});

describe('cursorToolKindFromName', () => {
  it('resolves every canonical Cursor tool name to a known kind', () => {
    const expectations = {
      Bash: 'bash',
      Read: 'read',
      Delete: 'delete',
      Glob: 'glob',
      Grep: 'grep',
      Write: 'write',
      Edit: 'edit',
      TodoWrite: 'todo',
      Task: 'task',
      AskUserQuestion: 'ask_user',
      ExitPlanMode: 'exit_plan',
      createPlan: 'exit_plan',
      mcp__baguette__create_issue: 'mcp',
      SomethingUnknown: 'generic',
    };
    for (const [name, kind] of Object.entries(expectations)) {
      expect(cursorToolKindFromName(name), name).toBe(kind);
    }
  });
});

describe('mapCursorToolArgs', () => {
  it('folds a Cursor updateTodos input into a one-element todos array', () => {
    const args = mapCursorToolArgs('todo', 'updateTodos', {
      subject: 'Polish plan',
      status: 'in_progress',
    });
    expect(args.todos).toEqual([
      expect.objectContaining({ content: 'Polish plan', status: 'in_progress' }),
    ]);
  });

  it('reads content from a flat { content, status } updateTodos payload', () => {
    const args = mapCursorToolArgs('todo', 'updateTodos', {
      content: 'Ship the fix',
      status: 'completed',
    });
    expect(args.todos).toEqual([
      expect.objectContaining({ content: 'Ship the fix', status: 'completed' }),
    ]);
  });

  it('defaults content to an empty string instead of the tool name', () => {
    // Regression: previously fell back to "TodoWrite" (the tool name) when
    // subject/description were missing, so the row rendered the literal
    // "TodoWrite" placeholder.
    const args = mapCursorToolArgs('todo', 'updateTodos', { status: 'completed' });
    expect(args.todos[0].content).toBe('');
    expect(args.todos[0].status).toBe('completed');
  });
});

describe('mapCursorBashToolResult', () => {
  it('unwraps the Cursor success envelope and reads exit/stdout', () => {
    const r = mapCursorBashToolResult({ status: 'success', value: { exitCode: 0, stdout: 'ok' } });
    expect(r).toMatchObject({ status: 'ok', exit_code: 0, stdout: 'ok' });
  });

  it('unwraps the Cursor error envelope and surfaces the message', () => {
    const r = mapCursorBashToolResult({
      status: 'error',
      error: { message: 'permission denied' },
    });
    expect(r).toMatchObject({ status: 'error', exit_code: 1, stderr: 'permission denied' });
  });
});

describe('mapCursorToolResult', () => {
  it('reduces bash result with exit_code', () => {
    const r = mapCursorToolResult('bash', {
      status: 'success',
      value: { exitCode: 0, stdout: 'x' },
    });
    expect(r).toMatchObject({ status: 'ok', exit_code: 0, stdout: 'x' });
  });
});

describe('cursorBuildToolCallStart / cursorBuildToolCallComplete', () => {
  it('builds a running row, then completes with a bash result', () => {
    const start = cursorBuildToolCallStart('id-1', 'shell', { command: 'ls' });
    expect(start.name).toBe('Bash');
    expect(start.status).toBe('running');
    const done = cursorBuildToolCallComplete(start, {
      rawResult: { status: 'success', value: { exitCode: 0, stdout: 'x' } },
    });
    expect(done.status).toBe('completed');
    expect(done.result).toMatchObject({ status: 'ok', exit_code: 0, stdout: 'x' });
  });

  it('marks an errored Cursor status as an error call', () => {
    const start = cursorBuildToolCallStart('id-2', 'read', { path: '/a' });
    expect(
      cursorBuildToolCallComplete(start, { toolCallStatus: 'error', isError: true }).status
    ).toBe('error');
  });
});
