import { describe, it, expect } from 'vitest';
import { sortSessionTodosAsc } from '../session-todo-sort.js';

describe('sortSessionTodosAsc', () => {
  it('orders by sort_order then ref ascending', () => {
    const todos = [
      { id: 3, ref: 3, sort_order: 0 },
      { id: 1, ref: 1, sort_order: 0 },
      { id: 2, ref: 2, sort_order: 1 },
    ];
    expect(sortSessionTodosAsc(todos).map((t) => t.ref)).toEqual([1, 3, 2]);
  });

  it('breaks ties on ref with id ascending', () => {
    const todos = [
      { id: 5, ref: 1, sort_order: 0 },
      { id: 2, ref: 1, sort_order: 0 },
    ];
    expect(sortSessionTodosAsc(todos).map((t) => t.id)).toEqual([2, 5]);
  });
});
