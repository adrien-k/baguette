import { describe, it, expect } from 'vitest';
import {
  collectRunningTools,
  collectRunningToolsForBottomBar,
  runningToolDisplay,
  shouldHideRunningBashInFlow,
  runningBashToolIds,
} from '../running-tools.js';

describe('collectRunningTools', () => {
  it('returns tools without stitched results', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'a', name: 'Read', input: { file_path: '/wt/src/a.js' } },
            {
              type: 'tool_use',
              id: 'b',
              name: 'Bash',
              input: { command: 'pnpm test' },
              result: 'ok',
            },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'c',
              name: 'mcp__baguette__GitPush',
              input: {},
            },
          ],
        },
      },
    ];

    const running = collectRunningTools(messages, { worktreePath: '/wt' });
    expect(running).toEqual([
      { id: 'a', label: 'Read', detail: './src/a.js' },
      { id: 'c', label: 'GitPush', detail: undefined },
    ]);
  });

  it('skips hidden tool_use blocks', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't', name: 'TodoWrite', input: {}, _hidden: true }],
        },
      },
    ];
    expect(collectRunningTools(messages)).toEqual([]);
  });

  it('dock lists every running Bash block with startedAt', () => {
    const messages = [
      {
        type: 'user',
        message: { role: 'user', content: 'go' },
      },
      {
        type: 'assistant',
        created_at: '2026-01-01T00:00:00.000Z',
        message: {
          content: [
            { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'a.js' } },
            { type: 'tool_use', id: 'bash1', name: 'Bash', input: { command: 'sleep 1' } },
          ],
        },
      },
      {
        type: 'assistant',
        created_at: '2026-01-01T00:00:10.000Z',
        message: {
          content: [
            { type: 'tool_use', id: 'bash2', name: 'Bash', input: { command: 'pnpm test' } },
          ],
        },
      },
    ];
    const dock = collectRunningToolsForBottomBar(messages, [], { sessionTurnActive: true });
    expect(dock).toHaveLength(2);
    expect(dock[0].id).toBe('bash1');
    expect(dock[0].startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dock[0].block.name).toBe('Bash');
    expect(dock[1].id).toBe('bash2');
  });

  it('includes running RunProjectCommand in the dock', () => {
    const messages = [
      {
        type: 'user',
        message: { role: 'user', content: 'run tests' },
      },
      {
        type: 'assistant',
        created_at: '2026-01-01T00:00:00.000Z',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'run1',
              name: 'mcp__baguette__RunProjectCommand',
              input: { label: 'Run tests' },
            },
          ],
        },
      },
    ];
    const dock = collectRunningToolsForBottomBar(messages, [], { sessionTurnActive: true });
    expect(dock).toHaveLength(1);
    expect(dock[0].id).toBe('run1');
  });

  it('dock ignores orphaned running Bash from a previous cancelled turn', () => {
    const messages = [
      {
        type: 'user',
        message: { role: 'user', content: 'first try' },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'stale', name: 'Bash', input: { command: 'sleep 999' } },
          ],
        },
      },
      {
        type: 'user',
        message: { role: 'user', content: 'retry' },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'current', name: 'Bash', input: { command: 'pnpm test' } },
          ],
        },
      },
    ];
    const dock = collectRunningToolsForBottomBar(messages, [], { sessionTurnActive: true });
    expect(dock).toHaveLength(1);
    expect(dock[0].id).toBe('current');
  });

  it('dock is empty when the session turn is not active', () => {
    const messages = [
      {
        type: 'user',
        message: { role: 'user', content: 'go' },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'bash1', name: 'Bash', input: { command: 'sleep' } }],
        },
      },
    ];
    expect(collectRunningToolsForBottomBar(messages, [], { sessionTurnActive: false })).toEqual([]);
  });

  it('hides pinned running Bash from the message list', () => {
    const block = { type: 'tool_use', id: 'bash1', name: 'Bash', input: { command: 'sleep' } };
    const ids = runningBashToolIds([{ id: 'bash1', block, startedAt: null }]);
    expect(shouldHideRunningBashInFlow(block, ids)).toBe(true);
    expect(shouldHideRunningBashInFlow({ ...block, result: 'done' }, ids)).toBe(false);
  });

  it('unwraps Cursor mcp meta-tool', () => {
    const block = {
      type: 'tool_use',
      id: 'm1',
      name: 'mcp',
      input: {
        toolName: 'RunProjectCommand',
        args: { label: 'Run tests', args: ['--grep', 'foo'] },
      },
    };
    expect(runningToolDisplay(block)).toEqual({
      label: 'Run tests',
      detail: '--grep foo',
    });
  });
});
