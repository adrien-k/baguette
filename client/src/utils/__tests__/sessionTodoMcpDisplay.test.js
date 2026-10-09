import { describe, it, expect } from 'vitest';
import { resolveSessionTodoForTool, todoContentFromArgs } from '../sessionTodoMcpDisplay.ts';

describe('todoContentFromArgs', () => {
  it('reads flat content', () => {
    expect(todoContentFromArgs({ content: '  hello  ' })).toBe('hello');
  });

  it('reads nested input.content', () => {
    expect(todoContentFromArgs({ input: { content: 'nested' } })).toBe('nested');
  });
});

describe('resolveSessionTodoForTool', () => {
  it('uses args.content after completion when result todo is missing', () => {
    const todo = resolveSessionTodoForTool(
      'CreateTodo',
      { content: '## Step 1\nDo thing' },
      { ok: true, todos: [] }
    );
    expect(todo?.content).toContain('Step 1');
    expect(todo?.status).toBe('pending');
  });

  it('uses todo from MCP payload', () => {
    const todo = resolveSessionTodoForTool(
      'CreateTodo',
      {},
      { todo: { id: 2, content: 'From API', status: 'pending' } }
    );
    expect(todo?.content).toBe('From API');
    expect(todo?.id).toBe(2);
  });

  it('falls back to last todos entry for CreateTodo', () => {
    const todo = resolveSessionTodoForTool(
      'CreateTodo',
      {},
      {
        todos: [{ id: 1, content: 'first', status: 'pending' }],
      }
    );
    expect(todo?.content).toBe('first');
  });
});
