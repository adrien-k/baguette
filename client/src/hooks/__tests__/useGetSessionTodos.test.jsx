// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const makeFind = () => {
    const queue = [];
    const fn = vi.fn(() => {
      const d = deferred();
      queue.push(d);
      return d.promise;
    });
    fn.queue = queue;
    return fn;
  };

  return { todosFind: makeFind() };
});

vi.mock('../../feathers.js', () => ({
  sessionTodosService: { find: mocks.todosFind },
}));

import { createTestQueryClient, makeQueryClientWrapper } from '../../queries/testUtils.jsx';
import { useGetSessionTodos } from '../useGetSessionTodos.js';

const TODO_ROWS = [
  { id: 1, ref: 1, sort_order: 1, status: 'pending', title: 'first' },
  { id: 2, ref: 3, sort_order: 0, status: 'pending', title: 'sorted-first' },
  { id: 3, ref: 2, sort_order: 1, status: 'pending', title: 'later-ref' },
  { id: 8, ref: 5, sort_order: 1, status: 'in_progress', title: 'active' },
  { id: 9, ref: 4, sort_order: 1, status: 'done', title: 'closed' },
];

beforeEach(() => {
  mocks.todosFind.mockClear();
  mocks.todosFind.queue.length = 0;
});

afterEach(cleanup);

async function loadTodos(index, rows) {
  await act(async () => {
    mocks.todosFind.queue[index].resolve({ data: rows });
  });
}

describe('useGetSessionTodos (React Query)', () => {
  it('sorts ascending and filters open todos when openOnly', async () => {
    const { result } = renderHook((id) => useGetSessionTodos(id, { openOnly: true }), {
      initialProps: 5,
      wrapper: makeQueryClientWrapper(createTestQueryClient()),
    });
    expect(mocks.todosFind).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ session_id: 5 }),
      })
    );
    await loadTodos(0, TODO_ROWS);
    await waitFor(() =>
      expect(result.current.todos.map((t) => t.title)).toEqual([
        'sorted-first',
        'first',
        'later-ref',
        'active',
      ])
    );
    expect(result.current.loading).toBe(false);
  });

  it('returns every status when openOnly is false (distinct key, refetch)', async () => {
    const { result, rerender } = renderHook(
      ({ id, openOnly }) => useGetSessionTodos(id, { openOnly }),
      {
        initialProps: { id: 5, openOnly: true },
        wrapper: makeQueryClientWrapper(createTestQueryClient()),
      }
    );
    await loadTodos(0, TODO_ROWS);
    await waitFor(() => expect(result.current.todos.length).toBe(4));

    rerender({ id: 5, openOnly: false });
    expect(result.current.todos).toEqual([]);
    await waitFor(() => expect(mocks.todosFind).toHaveBeenCalledTimes(2));
    await loadTodos(1, TODO_ROWS);

    await waitFor(() => expect(result.current.todos.length).toBe(TODO_ROWS.length));
    expect(result.current.todos.map((t) => t.status)).toContain('done');
  });

  it('does not fetch while disabled', async () => {
    const { result, rerender } = renderHook(
      ({ id, enabled }) => useGetSessionTodos(id, { enabled }),
      {
        initialProps: { id: 5, enabled: false },
        wrapper: makeQueryClientWrapper(createTestQueryClient()),
      }
    );
    await act(async () => {});
    expect(mocks.todosFind).not.toHaveBeenCalled();
    expect(result.current.todos).toEqual([]);
    expect(result.current.loading).toBe(false);

    rerender({ id: 5, enabled: true });
    await waitFor(() => expect(mocks.todosFind).toHaveBeenCalledTimes(1));
  });
});
