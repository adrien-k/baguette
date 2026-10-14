import { describe, it, expect } from 'vitest';
import {
  resolveSessionTodoForTool,
  todoContentFromArgs,
  todoIdFromArgs,
  todoTitleFromArgs,
} from '../sessionTodoMcpDisplay.ts';
import { sessionTodoTitle } from '../sessionTodoDisplay.ts';

describe('todoTitleFromArgs', () => {
  it('reads flat title', () => {
    expect(todoTitleFromArgs({ title: '  Ship it  ' })).toBe('Ship it');
  });

  it('reads nested input.title', () => {
    expect(todoTitleFromArgs({ input: { title: 'Nested' } })).toBe('Nested');
  });
});

describe('sessionTodoTitle', () => {
  it('uses stored title when set', () => {
    expect(sessionTodoTitle({ title: 'Short', content: 'Long body' })).toBe('Short');
  });

  it('falls back to first content line', () => {
    expect(sessionTodoTitle({ content: '## Heading\nDetails' })).toBe('## Heading');
  });
});

describe('todoContentFromArgs', () => {
  it('reads flat content', () => {
    expect(todoContentFromArgs({ content: '  hello  ' })).toBe('hello');
  });

  it('reads nested input.content', () => {
    expect(todoContentFromArgs({ input: { content: 'nested' } })).toBe('nested');
  });
});

describe('todoIdFromArgs', () => {
  it('reads nested tool ref', () => {
    expect(todoIdFromArgs({ input: { ref: 7 } })).toBe(7);
  });
});

describe('resolveSessionTodoForTool', () => {
  it('uses args.content after completion when result todo is missing', () => {
    const todo = resolveSessionTodoForTool(
      'CreateTodo',
      { title: 'Step 1', content: '## Step 1\nDo thing' },
      { ok: true, todos: [] }
    );
    expect(todo?.content).toContain('Step 1');
    expect(todo?.title).toBe('Step 1');
    expect(todo?.status).toBe('pending');
  });

  it('uses todo from MCP payload', () => {
    const todo = resolveSessionTodoForTool(
      'CreateTodo',
      {},
      { todo: { id: 2, ref: 2, content: 'From API', status: 'pending' } }
    );
    expect(todo?.content).toBe('From API');
    expect(todo?.id).toBe(2);
  });

  it('falls back to last todos entry for CreateTodo', () => {
    const todo = resolveSessionTodoForTool(
      'CreateTodo',
      {},
      {
        todos: [{ id: 1, ref: 1, content: 'first', status: 'pending' }],
      }
    );
    expect(todo?.content).toBe('first');
  });
});
