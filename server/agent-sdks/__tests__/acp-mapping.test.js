import { describe, it, expect } from 'vitest';
import {
  acpBuildToolCallComplete,
  acpToolCallBuilders,
  acpToolKindFromName,
  acpTurnResultOps,
  canonicalizeAcpToolName,
  mapAcpBashToolResult,
  mapAcpToolArgs,
  mapAcpUpdate,
} from '../acp-mapping.ts';

describe('unified acp-mapping', () => {
  it('canonicalizes ACP tool names and normalizes mcp_baguette_ single underscores', () => {
    expect(canonicalizeAcpToolName('run_command')).toBe('Bash');
    expect(canonicalizeAcpToolName('read_file')).toBe('Read');
    expect(canonicalizeAcpToolName('write_to_file')).toBe('Write');
    expect(canonicalizeAcpToolName('replace_file_content')).toBe('Edit');
    expect(canonicalizeAcpToolName('grep_search')).toBe('Grep');
    expect(canonicalizeAcpToolName('find_by_name')).toBe('Glob');
    expect(canonicalizeAcpToolName('delete_file')).toBe('Delete');
    expect(canonicalizeAcpToolName('mcp_baguette_CreateTodo')).toBe('mcp__baguette__CreateTodo');
    expect(canonicalizeAcpToolName('mcp__baguette__RunTask')).toBe('mcp__baguette__RunTask');
  });

  it('resolves tool kinds including AskUserQuestions, user MCP tools, and ACP kind fallback', () => {
    expect(acpToolKindFromName('Bash')).toBe('bash');
    expect(acpToolKindFromName('mcp__baguette__AskUserQuestions')).toBe('ask_user');
    expect(acpToolKindFromName('mcp__baguette__CreateTodo')).toBe('mcp');
    expect(acpToolKindFromName('mcp_custom_lookup')).toBe('mcp');
    expect(acpToolKindFromName('CustomTool')).toBe('generic');
    expect(acpToolKindFromName('CustomExec', 'execute')).toBe('bash');
  });

  it('maps ACP tool arguments across kinds and strips toolSummary on mcp', () => {
    expect(
      mapAcpToolArgs('bash', 'Bash', {
        CommandLine: 'echo hello',
        toolSummary: 'Run echo',
      })
    ).toEqual({ command: 'echo hello', description: 'Run echo' });

    expect(mapAcpToolArgs('read', 'Read', { AbsolutePath: '/repo/src/index.ts' })).toEqual({
      path: '/repo/src/index.ts',
    });

    expect(
      mapAcpToolArgs('write', 'Write', {
        TargetFile: '/repo/a.txt',
        CodeContent: 'hi',
      })
    ).toEqual({ path: '/repo/a.txt', content: 'hi' });

    expect(
      mapAcpToolArgs('edit', 'Edit', {
        TargetFile: '/repo/b.ts',
        ReplacementChunks: [{ TargetContent: 'old', ReplacementContent: 'new' }],
      })
    ).toEqual({ path: '/repo/b.ts', old_string: 'old', new_string: 'new' });

    expect(
      mapAcpToolArgs('edit', 'edit_file', {
        Path: '/repo/c.ts',
        Target: 'before',
        Replacement: 'after',
      })
    ).toEqual({ path: '/repo/c.ts', old_string: 'before', new_string: 'after' });

    expect(
      mapAcpToolArgs('mcp', 'mcp__baguette__CreateTodo', {
        title: 'Write tests',
        toolSummary: 'Internal summary',
      })
    ).toEqual({ tool: 'CreateTodo', title: 'Write tests' });

    expect(
      mapAcpToolArgs('task', 'Task', { description: 'Research', subagent_type: 'research' })
    ).toEqual({ description: 'Research', subagent_type: 'research' });
  });

  it('strips agy run_command envelope header and normalizes CRLF in bash results', () => {
    const mapped = mapAcpBashToolResult({
      output:
        'Created At: 2026-11-22T01:47:17+01:00\nCompleted At: 2026-11-22T01:47:17+01:00\nCommand exited with code 0.\n\nCommand output:\nbaguette_sdk_live_bash_stdout\r\n',
      exit_code: 0,
    });
    expect(mapped).toEqual({
      status: 'ok',
      error_message: null,
      exit_code: 0,
      stdout: 'baguette_sdk_live_bash_stdout\n',
      stderr: '',
    });

    const failed = mapAcpBashToolResult({
      output: 'Command exited with code 2.\n\nCommand output:\npermission denied\r\n',
    });
    expect(failed).toEqual({
      status: 'error',
      error_message: 'permission denied\n',
      exit_code: 2,
      stdout: 'permission denied\n',
      stderr: '',
    });
  });

  it('maps every ACP SessionUpdate kind to canonical MessageOp sequences', () => {
    expect(
      mapAcpUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'thinking...' },
      })
    ).toEqual([{ op: 'assistant_thinking', text: 'thinking...' }]);

    expect(
      mapAcpUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      })
    ).toEqual([{ op: 'assistant_text', text: 'hello' }]);

    expect(
      mapAcpUpdate({
        sessionUpdate: 'plan',
        entries: [{ content: 'Step 1', status: 'in_progress', priority: 'high' }],
      })
    ).toEqual([
      {
        op: 'tool_start',
        call_id: 'acp-plan',
        name: 'TodoWrite',
        input: { todos: [{ content: 'Step 1', status: 'in_progress' }] },
      },
      {
        op: 'tool_result',
        call_id: 'acp-plan',
        name: 'TodoWrite',
        input: { todos: [{ content: 'Step 1', status: 'in_progress' }] },
        raw: { todos: [{ content: 'Step 1', status: 'in_progress' }] },
        is_error: false,
        status: 'completed',
      },
    ]);

    expect(
      mapAcpUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: 'Run echo',
        name: 'run_command',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { CommandLine: 'echo hi' },
      })
    ).toEqual([
      {
        op: 'tool_start',
        call_id: 'tc-1',
        name: 'Bash',
        input: { CommandLine: 'echo hi' },
      },
    ]);

    expect(
      mapAcpUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-1',
          status: 'completed',
          rawOutput: {
            output: 'Command exited with code 0.\n\nCommand output:\nhi\r\n',
            exit_code: 0,
          },
        },
        { name: 'Bash', input: { CommandLine: 'echo hi' } }
      )
    ).toEqual([
      {
        op: 'tool_result',
        call_id: 'tc-1',
        name: 'Bash',
        raw: {
          output: 'Command exited with code 0.\n\nCommand output:\nhi\r\n',
          exit_code: 0,
        },
        is_error: false,
        status: 'completed',
      },
    ]);

    expect(
      mapAcpUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'plan-1',
        title: 'Plan',
        name: 'exit_plan_mode',
        status: 'completed',
        rawInput: { plan: '## Step 1\nDo thing' },
      })
    ).toEqual([{ op: 'plan', markdown: '## Step 1\nDo thing' }]);

    expect(
      mapAcpUpdate({
        sessionUpdate: 'usage_update',
        used: 100,
        size: 1000,
      })
    ).toBeNull();
  });

  it('builds running and completed ToolCallPayload rows and turn_result ops', () => {
    const builders = acpToolCallBuilders();
    const start = builders.buildToolCallStart(
      'tc-2',
      'mcp_baguette_CreateTodo',
      { title: 'Check status' },
      '2026-11-22T00:00:00.000Z'
    );
    expect(start).toMatchObject({
      type: 'tool_call',
      id: 'tc-2',
      kind: 'mcp',
      name: 'mcp__baguette__CreateTodo',
      status: 'running',
      args: { tool: 'CreateTodo', title: 'Check status' },
    });

    const end = acpBuildToolCallComplete(start, {
      rawResult: JSON.stringify({ id: 7 }),
      endedAt: '2026-11-22T00:00:01.000Z',
    });
    expect(end).toMatchObject({
      status: 'completed',
      result: {
        status: 'ok',
        error_message: null,
        data: { id: 7 },
      },
    });

    expect(acpTurnResultOps('error', 'boom')).toEqual([
      {
        op: 'turn_result',
        payload: {
          type: 'turn_result',
          status: 'error',
          error_message: 'boom',
          total_cost_usd: 0,
        },
      },
    ]);
  });

  it('unwraps Cursor mcp meta-tool calls into kind mcp or ask_user with actual tool name', () => {
    const builders = acpToolCallBuilders();
    const start = builders.buildToolCallStart(
      'tc-mcp-1',
      'mcp',
      {
        toolName: 'StartSubagent',
        args: { name: 'Public storage backend', toolSummary: 'Spawn backend worker' },
      },
      '2026-11-25T00:00:00.000Z'
    );
    expect(start).toMatchObject({
      kind: 'mcp',
      name: 'mcp',
      args: { tool: 'StartSubagent', name: 'Public storage backend' },
    });

    const askStart = builders.buildToolCallStart(
      'tc-mcp-2',
      'mcp',
      {
        tool: 'AskUserQuestions',
        args: { questions: [{ question: 'Proceed?' }] },
      },
      '2026-11-25T00:00:00.000Z'
    );
    expect(askStart).toMatchObject({
      kind: 'ask_user',
      name: 'mcp',
      args: { questions: [{ question: 'Proceed?' }] },
    });
  });
});
