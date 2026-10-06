import { describe, expect, it } from 'vitest';
import { applyTodoWriteCollapse, todoToolCallHasVisibleContent } from '../todo-write-display.js';

describe('todoToolCallHasVisibleContent', () => {
  it('is false for status-only todos', () => {
    expect(
      todoToolCallHasVisibleContent({
        type: 'tool_call',
        name: 'TodoWrite',
        kind: 'todo',
        args: { todos: [{ content: '', status: 'completed' }] },
      })
    ).toBe(false);
  });

  it('is true when any todo line has content', () => {
    expect(
      todoToolCallHasVisibleContent({
        type: 'tool_call',
        name: 'TodoWrite',
        kind: 'todo',
        args: { todos: [{ content: 'Ship fix', status: 'in_progress' }] },
      })
    ).toBe(true);
  });
});

describe('applyTodoWriteCollapse', () => {
  it('keeps the last non-empty TodoWrite and hides empty status-only updates', () => {
    const messages = [
      {
        id: 1,
        type: 'tool_call',
        name: 'TodoWrite',
        kind: 'todo',
        call_id: 'a',
        args: { todos: [{ content: 'First task', status: 'in_progress' }] },
      },
      {
        id: 2,
        type: 'tool_call',
        name: 'TodoWrite',
        kind: 'todo',
        call_id: 'b',
        args: { todos: [{ content: '', status: 'completed' }] },
      },
    ];
    const out = applyTodoWriteCollapse(messages);
    expect(out[0]._hidden).toBeUndefined();
    expect(out[1]._hidden).toBe(true);
  });

  it('shows the last snapshot that still has visible todo text', () => {
    const messages = [
      {
        id: 1,
        type: 'tool_call',
        name: 'TodoWrite',
        kind: 'todo',
        call_id: 'a',
        args: { todos: [{ content: 'Older', status: 'completed' }] },
      },
      {
        id: 2,
        type: 'tool_call',
        name: 'TodoWrite',
        kind: 'todo',
        call_id: 'b',
        args: { todos: [{ content: 'Current', status: 'in_progress' }] },
      },
      {
        id: 3,
        type: 'tool_call',
        name: 'TodoWrite',
        kind: 'todo',
        call_id: 'c',
        args: { todos: [{ content: '', status: 'completed' }] },
      },
    ];
    const out = applyTodoWriteCollapse(messages);
    expect(out[0]._hidden).toBe(true);
    expect(out[1]._hidden).toBeUndefined();
    expect(out[2]._hidden).toBe(true);
  });
});
