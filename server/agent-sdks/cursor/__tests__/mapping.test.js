import { describe, expect, it } from 'vitest';
import {
  mapCursorEvent,
  unwrapCursorResult,
  canonicalizeCursorToolName,
  cursorCanonicalToolName,
  cursorToolKindFromName,
  cursorMcpWrappedToolName,
  mapCursorToolResult,
  mapCursorBashToolResult,
  mapCursorToolArgs,
  cursorBuildToolCallStart,
  cursorBuildToolCallComplete,
} from '../mapping.ts';

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
      AskUserQuestions: 'ask_user',
      ExitPlanMode: 'exit_plan',
      createPlan: 'exit_plan',
      CreateTodo: 'mcp',
      UpdateTodo: 'mcp',
      DeleteTodo: 'mcp',
      ListTodos: 'mcp',
      CreatePlan: 'mcp',
      EditPlan: 'mcp',
      ReadPlan: 'mcp',
      StartPlan: 'mcp',
      ListPlans: 'mcp',
      CompletePlan: 'mcp',
      ConfigureMcpServer: 'mcp',
      mcp__baguette__create_issue: 'mcp',
      mcp__baguette__AskUserQuestions: 'ask_user',
      SomethingUnknown: 'generic',
    };
    for (const [name, kind] of Object.entries(expectations)) {
      expect(cursorToolKindFromName(name), name).toBe(kind);
    }
  });

  it("lifts AskUserQuestions out of Cursor's mcp meta-tool args", () => {
    // Cursor routes external MCP providers through a single `mcp` tool and
    // carries the real name in args.tool — previously this landed as kind 'mcp'
    // and rendered a quiet MCP row instead of the question card.
    expect(
      cursorToolKindFromName('mcp', {
        tool: 'AskUserQuestions',
        questions: [{ question: 'Which model?' }],
        providerIdentifier: 'custom-user-tools',
      })
    ).toBe('ask_user');
    expect(cursorToolKindFromName('mcp')).toBe('mcp');
    expect(cursorToolKindFromName('mcp', { tool: 'ReadTaskOutput', runId: '5' })).toBe('mcp');
  });
});

describe('cursorMcpWrappedToolName', () => {
  it('reads the nested tool name from meta-tool args', () => {
    expect(cursorMcpWrappedToolName('mcp', { tool: 'AskUserQuestions' })).toBe('AskUserQuestions');
    expect(cursorMcpWrappedToolName('mcp', { toolName: 'AskUserQuestions' })).toBe(
      'AskUserQuestions'
    );
    expect(cursorMcpWrappedToolName('mcp', { args: { tool: 'AskUserQuestions' } })).toBe(
      'AskUserQuestions'
    );
  });

  it('returns empty for non-meta or tool-less calls', () => {
    expect(cursorMcpWrappedToolName('Bash', { tool: 'AskUserQuestions' })).toBe('');
    expect(cursorMcpWrappedToolName('mcp', {})).toBe('');
    expect(cursorMcpWrappedToolName('mcp')).toBe('');
  });
});

describe('meta-tool AskUserQuestions end-to-end', () => {
  it('builds start/complete rows as ask_user with typed args', () => {
    const rawArgs = {
      tool: 'AskUserQuestions',
      questions: [{ question: 'Which model?', options: [{ label: 'Composer 2.5' }] }],
      providerIdentifier: 'custom-user-tools',
    };
    const start = cursorBuildToolCallStart('id-ask', 'mcp', rawArgs);
    expect(start.kind).toBe('ask_user');
    const done = cursorBuildToolCallComplete(start, {
      args: rawArgs,
      rawResult: { status: 'success', value: { ok: true, questions: rawArgs.questions } },
    });
    expect(done.kind).toBe('ask_user');
    expect(done.name).toBe('mcp');
    expect(done.args.questions).toEqual(rawArgs.questions);
    expect(done.status).toBe('completed');
    // ask_user rows carry only the base result shape — no mcp content envelope.
    expect(done.result).toMatchObject({ status: 'ok', error_message: null });
  });

  it('falls back to the running row args when complete omits args', () => {
    const running = cursorBuildToolCallStart('id-ask2', 'mcp');
    expect(running.kind).toBe('mcp');
    const rawArgs = { tool: 'AskUserQuestions', questions: [{ question: 'Plan?' }] };
    const done = cursorBuildToolCallComplete(running, { args: rawArgs });
    expect(done.kind).toBe('ask_user');
    expect(done.args.questions).toEqual(rawArgs.questions);
  });

  // Regression for session 994: the meta-tool call resolved to kind 'ask_user'
  // but the stored row was `args: { questions: [] }` because the questions sat
  // inside the meta-tool envelope instead of at the top level — the UI showed
  // only "The agent has a question" with no content to answer.
  const nestedEnvelopeCases = [
    {
      label: 'toolName at top level, questions under args',
      rawArgs: {
        toolName: 'AskUserQuestions',
        args: { questions: [{ question: 'Which transport?' }] },
      },
    },
    {
      label: 'tool at top level, questions under args',
      rawArgs: {
        tool: 'AskUserQuestions',
        args: { questions: [{ question: 'Which transport?' }] },
      },
    },
    {
      label: 'tool and questions both nested under args',
      rawArgs: {
        args: { tool: 'AskUserQuestions', questions: [{ question: 'Which transport?' }] },
      },
    },
  ];

  it.each(nestedEnvelopeCases)('keeps questions when $label', ({ rawArgs }) => {
    const start = cursorBuildToolCallStart('id-nested', 'mcp', rawArgs);
    expect(start.kind).toBe('ask_user');
    const done = cursorBuildToolCallComplete(start, {
      args: rawArgs,
      rawResult: { status: 'success', value: { ok: true } },
    });
    expect(done.kind).toBe('ask_user');
    expect(done.args.questions).toEqual([{ question: 'Which transport?' }]);
  });

  it('does not unwrap nested args for a direct ask_user call', () => {
    const rawArgs = {
      questions: [{ question: 'Ship it?' }],
      args: { questions: [{ question: 'stale' }] },
    };
    const start = cursorBuildToolCallStart('id-direct', 'AskUserQuestions', rawArgs);
    expect(start.kind).toBe('ask_user');
    expect(start.args.questions).toEqual([{ question: 'Ship it?' }]);
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
