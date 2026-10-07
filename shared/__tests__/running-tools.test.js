import { describe, it, expect } from 'vitest';
import {
  collectRunningTools,
  collectRunningToolsForBottomBar,
  runningToolDisplay,
  shouldHideRunningToolCallInFlow,
  runningBashToolIds,
} from '../running-tools.js';

function runningToolCall(id, name, args = {}) {
  return {
    type: 'tool_call',
    id: 1,
    call_id: id,
    name,
    kind: name === 'Bash' ? 'bash' : 'mcp',
    status: 'running',
    args,
    result: null,
    tool_status: 'running',
    tool_started_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('collectRunningTools', () => {
  it('returns running tool_call rows without results', () => {
    const messages = [
      runningToolCall('a', 'Read', { file_path: '/wt/src/a.js' }),
      {
        ...runningToolCall('b', 'Bash', { command: 'pnpm test' }),
        result: { exit_code: 0, stdout: 'ok', stderr: '' },
        tool_status: 'completed',
        status: 'completed',
      },
      runningToolCall('c', 'mcp__baguette__GitPush', {}),
    ];

    const running = collectRunningTools(messages, { sessionPath: '/wt' });
    expect(running).toEqual([
      { id: 'a', label: 'Read', detail: './src/a.js' },
      { id: 'c', label: 'GitPush', detail: undefined },
    ]);
  });

  it('dock lists every running Bash tool_call with startedAt', () => {
    const messages = [
      { type: 'user', content: 'go' },
      runningToolCall('bash1', 'Bash', { command: 'sleep 1' }),
      runningToolCall('bash2', 'Bash', { command: 'pnpm test' }),
    ];
    const dock = collectRunningToolsForBottomBar(messages, [], { sessionTurnActive: true });
    expect(dock).toHaveLength(2);
    expect(dock[0].id).toBe('bash1');
    expect(dock[0].message.name).toBe('Bash');
    expect(dock[1].id).toBe('bash2');
  });

  it('includes running RunTask in the dock', () => {
    const messages = [
      { type: 'user', content: 'run tests' },
      runningToolCall('run1', 'mcp', { toolName: 'RunTask', label: 'Run tests' }),
    ];
    const dock = collectRunningToolsForBottomBar(messages, [], { sessionTurnActive: true });
    expect(dock).toHaveLength(1);
    expect(dock[0].id).toBe('run1');
  });

  it('dock ignores orphaned running Bash from a previous cancelled turn', () => {
    const messages = [
      { type: 'user', content: 'first try' },
      runningToolCall('stale', 'Bash', { command: 'sleep 999' }),
      { type: 'user', content: 'retry' },
      runningToolCall('current', 'Bash', { command: 'pnpm test' }),
    ];
    const dock = collectRunningToolsForBottomBar(messages, [], { sessionTurnActive: true });
    expect(dock).toHaveLength(1);
    expect(dock[0].id).toBe('current');
  });

  it('dock is empty when the session turn is not active', () => {
    const messages = [
      { type: 'user', content: 'go' },
      runningToolCall('bash1', 'Bash', { command: 'sleep' }),
    ];
    expect(collectRunningToolsForBottomBar(messages, [], { sessionTurnActive: false })).toEqual([]);
  });

  it('hides pinned running Bash tool_call from the message list', () => {
    const msg = runningToolCall('bash1', 'Bash', { command: 'sleep' });
    const ids = runningBashToolIds([{ id: 'bash1', message: msg, startedAt: null }]);
    expect(shouldHideRunningToolCallInFlow(msg, ids)).toBe(true);
    expect(
      shouldHideRunningToolCallInFlow(
        { ...msg, result: { exit_code: 0, stdout: '', stderr: '' }, tool_status: 'completed' },
        ids
      )
    ).toBe(false);
  });

  it('unwraps the mcp meta-tool name to its real tool for display', () => {
    const block = {
      type: 'tool_use',
      id: 'm1',
      name: 'mcp',
      input: {
        toolName: 'RunTask',
        args: { label: 'Run tests', args: ['--grep', 'foo'] },
      },
    };
    expect(runningToolDisplay(block)).toEqual({
      label: 'Run tests',
      detail: '--grep foo',
    });
  });
});
