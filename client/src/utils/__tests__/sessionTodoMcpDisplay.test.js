import { describe, it, expect } from 'vitest';
import {
  resolveSessionTodoForTool,
  todoContentFromArgs,
  todoIdFromArgs,
  todoRefsFromArgs,
  todoTitleFromArgs,
  updateTodoStatusOnlyHeading,
} from '../sessionTodoMcpDisplay.ts';
import { sessionTodoTitle } from '../sessionTodoDisplay.ts';
import { parseMcpJsonResult } from '../parseMcpJsonResult.ts';

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

describe('todoRefsFromArgs', () => {
  it('dedupes refs from flat args', () => {
    expect(todoRefsFromArgs({ refs: [1, 2, 1] })).toEqual([1, 2]);
  });
});

describe('updateTodoStatusOnlyHeading', () => {
  it('returns heading for status-only updates', () => {
    expect(updateTodoStatusOnlyHeading({ status: 'in_progress' })).toBe('Todo in progress');
  });

  it('returns null when title or content is set', () => {
    expect(updateTodoStatusOnlyHeading({ status: 'completed', content: 'New body' })).toBeNull();
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

  it('uses args content for UpdateTodo when result todo is missing', () => {
    const todo = resolveSessionTodoForTool(
      'UpdateTodo',
      { ref: 7, title: 'Cards', content: '## Body\nDetails', status: 'in_progress' },
      { ok: true, todos: [] }
    );
    expect(todo?.content).toContain('Body');
    expect(todo?.title).toBe('Cards');
    expect(todo?.status).toBe('in_progress');
    expect(todo?.ref).toBe(7);
  });

  it('uses todo from wrapped UpdateTodo MCP payload', () => {
    const wrapped = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: true,
            todo: { id: 1, ref: 7, content: 'From wrapped API', status: 'completed' },
          }),
        },
      ],
    };
    const mcpResult = parseMcpJsonResult(wrapped);
    const todo = resolveSessionTodoForTool('UpdateTodo', { ref: 7 }, mcpResult);
    expect(todo?.content).toBe('From wrapped API');
    expect(todo?.status).toBe('completed');
  });
});
