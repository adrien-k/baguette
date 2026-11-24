import { describe, it, expect } from 'vitest';
import {
  antigravityBuildToolCallComplete,
  antigravityBuildToolCallStart,
  antigravityToolKindFromName,
  antigravityTurnResultOps,
  canonicalizeAntigravityToolName,
  mapAntigravityBashToolResult,
  mapAntigravityToolArgs,
  mapAntigravityUpdate,
} from '../mapping.ts';

describe('antigravity mapping', () => {
  it('canonicalizes ACP tool names and normalizes mcp_baguette_ single underscores', () => {
    expect(canonicalizeAntigravityToolName('run_command')).toBe('Bash');
    expect(canonicalizeAntigravityToolName('read_file')).toBe('Read');
    expect(canonicalizeAntigravityToolName('write_to_file')).toBe('Write');
    expect(canonicalizeAntigravityToolName('replace_file_content')).toBe('Edit');
    expect(canonicalizeAntigravityToolName('grep_search')).toBe('Grep');
    expect(canonicalizeAntigravityToolName('find_by_name')).toBe('Glob');
    expect(canonicalizeAntigravityToolName('delete_file')).toBe('Delete');
    expect(canonicalizeAntigravityToolName('mcp_baguette_CreateTodo')).toBe(
      'mcp__baguette__CreateTodo'
    );
    expect(canonicalizeAntigravityToolName('mcp__baguette__RunTask')).toBe(
      'mcp__baguette__RunTask'
    );
  });

  it('resolves tool kinds cleanly including AskUserQuestions and user MCP tools', () => {
    expect(antigravityToolKindFromName('Bash')).toBe('bash');
    expect(antigravityToolKindFromName('mcp__baguette__AskUserQuestions')).toBe('ask_user');
    expect(antigravityToolKindFromName('mcp__baguette__CreateTodo')).toBe('mcp');
    expect(antigravityToolKindFromName('mcp_custom_lookup')).toBe('mcp');
    expect(antigravityToolKindFromName('CustomTool')).toBe('generic');
  });

  it('maps PascalCase antigravity tool arguments and strips toolSummary on mcp', () => {
    expect(
      mapAntigravityToolArgs('bash', 'Bash', {
        CommandLine: 'echo hello',
        toolSummary: 'Run echo',
      })
    ).toEqual({ command: 'echo hello', description: 'Run echo' });

    expect(mapAntigravityToolArgs('read', 'Read', { AbsolutePath: '/repo/src/index.ts' })).toEqual({
      path: '/repo/src/index.ts',
    });

    expect(
      mapAntigravityToolArgs('write', 'Write', {
        TargetFile: '/repo/a.txt',
        CodeContent: 'hi',
      })
    ).toEqual({ path: '/repo/a.txt', content: 'hi' });

    expect(
      mapAntigravityToolArgs('edit', 'Edit', {
        TargetFile: '/repo/b.ts',
        ReplacementChunks: [{ TargetContent: 'old', ReplacementContent: 'new' }],
      })
    ).toEqual({ path: '/repo/b.ts', old_string: 'old', new_string: 'new' });

    expect(
      mapAntigravityToolArgs('mcp', 'mcp__baguette__CreateTodo', {
        title: 'Write tests',
        toolSummary: 'Internal summary',
      })
    ).toEqual({ tool: 'CreateTodo', title: 'Write tests' });
  });

  it('strips agy run_command envelope header and normalizes CRLF in bash results', () => {
    const mapped = mapAntigravityBashToolResult({
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

    const failed = mapAntigravityBashToolResult({
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

  it('maps ACP SessionUpdate frames to canonical MessageOp sequences', () => {
    expect(
      mapAntigravityUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'thinking...' },
      })
    ).toEqual([{ op: 'assistant_thinking', text: 'thinking...' }]);

    expect(
      mapAntigravityUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      })
    ).toEqual([{ op: 'assistant_text', text: 'hello' }]);

    expect(
      mapAntigravityUpdate({
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
      mapAntigravityUpdate(
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
      mapAntigravityUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'plan-1',
        title: 'Plan',
        name: 'exit_plan_mode',
        status: 'completed',
        rawInput: { plan: '## Step 1\nDo thing' },
      })
    ).toEqual([{ op: 'plan', markdown: '## Step 1\nDo thing' }]);
  });

  it('builds running and completed ToolCallPayload rows and turn_result ops', () => {
    const start = antigravityBuildToolCallStart(
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

    const end = antigravityBuildToolCallComplete(start, {
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

    expect(antigravityTurnResultOps('error', 'boom')).toEqual([
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
});
