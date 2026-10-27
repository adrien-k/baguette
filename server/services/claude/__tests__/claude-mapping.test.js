import { describe, expect, it } from 'vitest';
import {
  mapClaudeMessage,
  isClaudeHumanUserMessage,
  claudeCanonicalToolName,
  claudeToolKindFromName,
  mapClaudeToolResult,
  mapClaudeBashToolResult,
  mapClaudeToolArgs,
  claudeBuildToolCallStart,
  claudeBuildToolCallComplete,
} from '../claude-mapping.ts';

// Test fixtures cast through `unknown` — they exercise the mapper's runtime
// behaviour, not the SDK type surface. The cast lets us construct minimal
// shapes without duplicating every required SDK field in the test file.
const asClaude = (v) => /** @type {any} */ (v);

describe('mapClaudeMessage', () => {
  it('maps assistant text to a text op', () => {
    const ops = mapClaudeMessage(
      asClaude({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      })
    );
    expect(ops).toEqual([{ op: 'assistant_text', text: 'hello' }]);
  });

  it('maps thinking blocks separately from text', () => {
    const ops = mapClaudeMessage(
      asClaude({
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'pondering' }] },
      })
    );
    expect(ops).toEqual([{ op: 'assistant_thinking', text: 'pondering' }]);
  });

  it('maps lowercase bash tool_use to Bash bash kind', () => {
    const ops = mapClaudeMessage(
      asClaude({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'call_bash',
              name: 'bash',
              input: { command: 'git status', description: 'Show working tree status' },
            },
          ],
        },
      })
    );
    expect(ops).toEqual([
      {
        op: 'tool_start',
        call_id: 'call_bash',
        name: 'Bash',
        input: { command: 'git status', description: 'Show working tree status' },
      },
    ]);
    const start = claudeBuildToolCallStart('call_bash', 'bash', {
      command: 'git status',
      description: 'Show working tree status',
    });
    expect(start.kind).toBe('bash');
    expect(start.args.command).toBe('git status');
  });

  it('maps tool_use to a tool_start op', () => {
    const ops = mapClaudeMessage(
      asClaude({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'ls' } }],
        },
      })
    );
    expect(ops).toEqual([
      { op: 'tool_start', call_id: 'call_1', name: 'Bash', input: { command: 'ls' } },
    ]);
  });

  it('turns a plan tool_use into a plan op, never a tool_start', () => {
    const ops = mapClaudeMessage(
      asClaude({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'p1', name: 'ExitPlanMode', input: { plan: '# Steps' } },
          ],
        },
      })
    );
    expect(ops).toEqual([{ op: 'plan', markdown: '# Steps' }]);
  });

  it('maps tool_result blocks to tool_result ops and flattens text blocks', () => {
    const ops = mapClaudeMessage(
      asClaude({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: [{ type: 'text', text: 'out' }],
            },
          ],
        },
      })
    );
    expect(ops).toEqual([{ op: 'tool_result', call_id: 'call_1', raw: 'out', is_error: false }]);
  });

  it('propagates tool_result errors', () => {
    const ops = mapClaudeMessage(
      asClaude({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'c', content: 'boom', is_error: true }],
        },
      })
    );
    expect(ops[0]).toMatchObject({ is_error: true });
  });

  it('drops replayed messages', () => {
    expect(
      mapClaudeMessage(
        asClaude({
          type: 'assistant',
          isReplay: true,
          message: { content: [{ type: 'text', text: 'x' }] },
        })
      )
    ).toBeNull();
  });

  it('maps result to a turn_result verdict', () => {
    expect(
      mapClaudeMessage(asClaude({ type: 'result', subtype: 'success', total_cost_usd: 0.5 }))
    ).toEqual([
      {
        op: 'turn_result',
        payload: { type: 'turn_result', status: 'ok', error_message: null, total_cost_usd: 0.5 },
      },
    ]);
  });

  it('surfaces a failed result', () => {
    const ops = mapClaudeMessage(
      asClaude({
        type: 'result',
        subtype: 'error_during_execution',
        errors: ['broke'],
      })
    );
    expect(ops[0]).toMatchObject({
      op: 'turn_result',
      payload: { status: 'error', error_message: 'broke' },
    });
  });

  it('maps a rejected usage-limit event to a status row', () => {
    const ops = mapClaudeMessage(
      asClaude({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'rejected',
          rateLimitType: 'five_hour',
          resetsAt: 1793064000,
        },
      })
    );
    expect(ops[0]).toMatchObject({
      op: 'system',
      payload: { type: 'system', subtype: 'status' },
    });
    expect(ops[0].payload.status).toContain('Claude usage limit reached (five hour)');
    // Epoch seconds are formatted as a UTC timestamp after the dash.
    expect(ops[0].payload.status).toMatch(/resets \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  });

  it('drops allowed usage-limit events (only rejections surface)', () => {
    expect(
      mapClaudeMessage(
        asClaude({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })
      )
    ).toBeNull();
    expect(
      mapClaudeMessage(
        asClaude({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } })
      )
    ).toBeNull();
    expect(mapClaudeMessage(asClaude({ type: 'rate_limit_event' }))).toBeNull();
  });

  it('derives error copy from the result subtype when the CLI carries no text', () => {
    const ops = mapClaudeMessage(
      asClaude({ type: 'result', subtype: 'error_max_turns', is_error: true })
    );
    expect(ops[0]).toMatchObject({ op: 'turn_result' });
    expect(ops[0].payload.error_message).toContain('maximum number of turns');
  });

  it('prefers terminal_reason copy over the generic fallback', () => {
    const ops = mapClaudeMessage(
      asClaude({
        type: 'result',
        subtype: 'error_during_execution',
        terminal_reason: 'blocking_limit',
      })
    );
    expect(ops[0].payload.error_message).toContain('blocking_limit');
  });

  it('produces no rows for control-flow system events', () => {
    expect(mapClaudeMessage(asClaude({ type: 'system', subtype: 'init' }))).toBeNull();
    expect(mapClaudeMessage(asClaude({ type: 'system', subtype: 'task_started' }))).toBeNull();
  });

  it('maps thinking_tokens to a system op', () => {
    expect(
      mapClaudeMessage(
        asClaude({
          type: 'system',
          subtype: 'thinking_tokens',
          estimated_tokens: 12,
          estimated_tokens_delta: null,
        })
      )
    ).toEqual([
      {
        op: 'system',
        payload: {
          type: 'system',
          subtype: 'thinking_tokens',
          estimated_tokens: 12,
          estimated_tokens_delta: null,
        },
      },
    ]);
  });

  it('returns null for an unknown message type', () => {
    expect(mapClaudeMessage(asClaude({ type: 'something_new' }))).toBeNull();
  });

  it('accepts the SDK-typed thinking_tokens variant', () => {
    // Mirror of the SDK's SDKThinkingTokensMessage shape — no typedef, no fixture.
    // If the SDK renames the field, this test fails to compile.
    const msg = /** @type {import('@anthropic-ai/claude-agent-sdk').SDKThinkingTokensMessage} */ ({
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 42,
      estimated_tokens_delta: 7,
      uuid: 'u-1',
      session_id: 's-1',
    });
    expect(mapClaudeMessage(msg)).toEqual([
      {
        op: 'system',
        payload: {
          type: 'system',
          subtype: 'thinking_tokens',
          estimated_tokens: 42,
          estimated_tokens_delta: 7,
        },
      },
    ]);
  });
});

describe('isClaudeHumanUserMessage', () => {
  it('is false for tool_result-only user messages', () => {
    expect(
      isClaudeHumanUserMessage(
        asClaude({ type: 'user', message: { content: [{ type: 'tool_result' }] } })
      )
    ).toBe(false);
  });

  it('is true for text user messages', () => {
    expect(isClaudeHumanUserMessage(asClaude({ type: 'user', message: { content: 'hi' } }))).toBe(
      true
    );
  });
});

describe('claudeCanonicalToolName', () => {
  it('passes MCP names through verbatim', () => {
    expect(claudeCanonicalToolName('mcp__baguette__create_issue')).toBe(
      'mcp__baguette__create_issue'
    );
  });

  it('folds TaskCreate/TaskUpdate/TaskList into TodoWrite', () => {
    expect(claudeCanonicalToolName('TaskCreate')).toBe('TodoWrite');
    expect(claudeCanonicalToolName('TaskUpdate')).toBe('TodoWrite');
    expect(claudeCanonicalToolName('TaskList')).toBe('TodoWrite');
  });

  it('returns "generic" for empty input', () => {
    expect(claudeCanonicalToolName('')).toBe('generic');
    expect(claudeCanonicalToolName(null)).toBe('generic');
    expect(claudeCanonicalToolName(undefined)).toBe('generic');
  });

  it('returns identity for other names', () => {
    expect(claudeCanonicalToolName('Bash')).toBe('Bash');
    expect(claudeCanonicalToolName('Read')).toBe('Read');
  });

  it('maps lowercase bash/shell to Bash', () => {
    expect(claudeCanonicalToolName('bash')).toBe('Bash');
    expect(claudeCanonicalToolName('shell')).toBe('Bash');
  });
});

describe('claudeToolKindFromName', () => {
  it('resolves every canonical Claude tool name to a known kind', () => {
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
      Agent: 'task',
      AskUserQuestion: 'ask_user',
      ExitPlanMode: 'exit_plan',
      mcp__baguette__create_issue: 'mcp',
      SomethingUnknown: 'generic',
    };
    for (const [name, kind] of Object.entries(expectations)) {
      expect(claudeToolKindFromName(name), name).toBe(kind);
    }
  });
});

describe('mapClaudeToolArgs', () => {
  it('folds a TaskCreate input into a one-element todos array', () => {
    const args = mapClaudeToolArgs('todo', 'TaskCreate', {
      subject: 'Ship it',
      status: 'in_progress',
    });
    expect(args.todos).toEqual([
      expect.objectContaining({ content: 'Ship it', status: 'in_progress' }),
    ]);
  });

  it('concatenates TaskCreate subject and description with a colon', () => {
    const args = mapClaudeToolArgs('todo', 'TaskCreate', {
      subject: 'Ship the fix',
      description: 'Run the deploy script and verify the build',
      status: 'in_progress',
    });
    expect(args.todos[0]).toMatchObject({
      content: 'Ship the fix: Run the deploy script and verify the build',
      status: 'in_progress',
    });
  });

  it('uses TaskUpdate subject when only subject is provided', () => {
    const args = mapClaudeToolArgs('todo', 'TaskUpdate', {
      taskId: '1',
      subject: 'Retitled task',
    });
    expect(args.todos[0]).toMatchObject({
      content: 'Retitled task',
      status: 'pending',
    });
  });

  it('uses TaskUpdate description when only description is provided', () => {
    const args = mapClaudeToolArgs('todo', 'TaskUpdate', {
      taskId: '1',
      description: 'Just the description, no subject',
    });
    expect(args.todos[0].content).toBe('Just the description, no subject');
  });

  it('concatenates TaskUpdate subject and description when both are patched', () => {
    const args = mapClaudeToolArgs('todo', 'TaskUpdate', {
      taskId: '1',
      subject: 'Retitled task',
      description: 'With a longer description',
      status: 'completed',
    });
    expect(args.todos[0]).toMatchObject({
      content: 'Retitled task: With a longer description',
      status: 'completed',
    });
  });

  it('prefers content over subject/description when both are set', () => {
    // A flat { content } wins so a Claude TodoWrite single-object payload
    // is not accidentally rewritten into "subject: description" form.
    const args = mapClaudeToolArgs('todo', 'TodoWrite', {
      content: 'From content',
      subject: 'From subject',
      description: 'From description',
    });
    expect(args.todos[0].content).toBe('From content');
  });

  it('passes a pre-formed todos list through', () => {
    const args = mapClaudeToolArgs('todo', 'TodoWrite', {
      todos: [{ content: 'A', status: 'pending' }],
    });
    expect(args.todos).toEqual([{ content: 'A', status: 'pending' }]);
  });

  it('reads content from a single-todo TodoWrite payload (no array wrapper)', () => {
    // Claude's newer TodoWrite sometimes emits a flat { content, status,
    // activeForm } object instead of wrapping in { todos: [...] }. The mapper
    // must surface the real content, not fall back to the literal tool name.
    const args = mapClaudeToolArgs('todo', 'TodoWrite', {
      content: 'Ship the fix',
      status: 'completed',
      activeForm: 'Shipping the fix',
    });
    expect(args.todos).toEqual([
      {
        content: 'Ship the fix',
        status: 'completed',
        activeForm: 'Shipping the fix',
      },
    ]);
  });

  it('defaults content to an empty string instead of the tool name', () => {
    // Regression: the previous fallback used toolName ("TodoWrite") as the
    // content default, so malformed / subject-less payloads rendered as the
    // literal string "TodoWrite" in the chat list.
    const args = mapClaudeToolArgs('todo', 'TodoWrite', { status: 'completed' });
    expect(args.todos[0].content).toBe('');
    expect(args.todos[0].status).toBe('completed');
  });
});

describe('mapClaudeBashToolResult', () => {
  it('maps exit code and streams', () => {
    const r = mapClaudeBashToolResult({ exitCode: 2, stdout: 'ok', stderr: 'warn' });
    expect(r).toEqual({
      status: 'ok',
      error_message: null,
      exit_code: 2,
      stdout: 'ok',
      stderr: 'warn',
    });
  });

  it('returns exit 1 when isError is set even with no payload', () => {
    expect(mapClaudeBashToolResult(undefined, { isError: true })).toMatchObject({
      exit_code: 1,
    });
  });
});

describe('mapClaudeToolResult', () => {
  it('reduces bash result with exit_code', () => {
    const r = mapClaudeToolResult('bash', { exitCode: 0, stdout: 'hi', stderr: '' });
    expect(r).toMatchObject({ status: 'ok', exit_code: 0, stdout: 'hi', stderr: '' });
  });

  it('flattens Claude MCP content blocks to text', () => {
    const r = mapClaudeToolResult('mcp', [{ type: 'text', text: '{"ok":true}' }]);
    expect(r).toMatchObject({ status: 'ok', content: '{"ok":true}' });
  });
});

describe('claudeBuildToolCallStart / claudeBuildToolCallComplete', () => {
  it('builds a running row, then completes with a bash result', () => {
    const start = claudeBuildToolCallStart('id-1', 'Bash', { command: 'echo hi' });
    expect(start.status).toBe('running');
    expect(start.result).toBeNull();
    const done = claudeBuildToolCallComplete(start, {
      rawResult: { exitCode: 0, stdout: 'hi\n', stderr: '' },
    });
    expect(done.status).toBe('completed');
    expect(done.result).toEqual({
      status: 'ok',
      error_message: null,
      exit_code: 0,
      stdout: 'hi\n',
      stderr: '',
    });
  });

  it('marks the call cancelled when toolCallStatus says so', () => {
    const start = claudeBuildToolCallStart('id-2', 'Bash', { command: 'true' });
    const done = claudeBuildToolCallComplete(start, {
      toolCallStatus: 'cancelled',
      rawResult: 'Turn ended',
    });
    expect(done.status).toBe('cancelled');
  });

  it('marks an errored Claude status as an error call', () => {
    const start = claudeBuildToolCallStart('id-3', 'Read', { path: '/tmp/x' });
    expect(
      claudeBuildToolCallComplete(start, { toolCallStatus: 'error', isError: true }).status
    ).toBe('error');
  });

  it('keeps bash command when complete args are an empty object', () => {
    const start = claudeBuildToolCallStart('id-4', 'Bash', {
      command: 'echo test',
      description: 'd',
    });
    const done = claudeBuildToolCallComplete(start, { args: {}, rawResult: 'test' });
    expect(done.args.command).toBe('echo test');
    expect(done.args.description).toBe('d');
  });
});
