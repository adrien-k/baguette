// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  const makeService = (methodNames) => {
    const listeners = [];
    const api = {};
    for (const name of methodNames) {
      const queue = [];
      const fn = vi.fn(() => {
        const d = deferred();
        queue.push(d);
        return d.promise;
      });
      fn.queue = queue;
      api[name] = fn;
    }
    api.on = (event, listener) => listeners.push({ event, listener });
    api.off = (event, listener) => {
      const index = listeners.findIndex((l) => l.event === event && l.listener === listener);
      if (index !== -1) listeners.splice(index, 1);
    };
    api.emit = (event, payload) => {
      for (const l of [...listeners]) {
        if (l.event === event) l.listener(payload);
      }
    };
    return api;
  };

  const resetService = (api) => {
    for (const key of Object.keys(api)) {
      const value = api[key];
      if (typeof value === 'function' && Array.isArray(value.queue)) {
        value.queue.length = 0;
      }
      if (typeof value === 'function' && vi.isMockFunction(value)) {
        value.mockClear();
      }
    }
  };

  return { sessionTodosService: makeService(['find']), resetService };
});

vi.mock('../../feathers.js', () => ({ sessionTodosService: mocks.sessionTodosService }));

import { useGetSessionTodos } from '../useGetSessionTodos.js';

beforeEach(() => mocks.resetService(mocks.sessionTodosService));

afterEach(cleanup);

async function flush() {
  await act(async () => {});
}

const TODO_ROWS = [
  { id: 1, ref: 1, sort_order: 1, status: 'pending', title: 'first' },
  { id: 2, ref: 3, sort_order: 0, status: 'pending', title: 'sorted-first' },
  { id: 3, ref: 2, sort_order: 1, status: 'pending', title: 'later-ref' },
  { id: 8, ref: 5, sort_order: 1, status: 'in_progress', title: 'active' },
  { id: 9, ref: 4, sort_order: 1, status: 'done', title: 'closed' },
];

async function loadTodos(index, rows) {
  await act(async () => {
    mocks.sessionTodosService.find.queue[index].resolve({ data: rows });
  });
}

describe('useGetSessionTodos', () => {
  it('sorts ascending and filters open todos when openOnly', async () => {
    const { result } = renderHook((id) => useGetSessionTodos(id, { openOnly: true }), {
      initialProps: 5,
    });
    await flush();
    expect(mocks.sessionTodosService.find).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ session_id: 5 }),
      })
    );
    await loadTodos(0, TODO_ROWS);
    expect(result.current.todos.map((t) => t.title)).toEqual([
      'sorted-first',
      'first',
      'later-ref',
      'active',
    ]);
    expect(result.current.loading).toBe(false);
  });

  it('returns every status when openOnly is false (distinct key, refetch)', async () => {
    const { result, rerender } = renderHook(
      ({ id, openOnly }) => useGetSessionTodos(id, { openOnly }),
      { initialProps: { id: 5, openOnly: true } }
    );
    await flush();
    await loadTodos(0, TODO_ROWS);
    const openCount = result.current.todos.length;

    rerender({ id: 5, openOnly: false });
    expect(result.current.todos).toEqual([]);
    await flush();
    expect(mocks.sessionTodosService.find).toHaveBeenCalledTimes(2);
    await loadTodos(1, TODO_ROWS);
    expect(result.current.todos.map((t) => t.status)).toContain('done');
    expect(result.current.todos.length).toBe(TODO_ROWS.length);
    expect(result.current.todos.length).toBe(openCount + 1);
  });

  it('reloads when todo events arrive for the current session', async () => {
    const { result } = renderHook((id) => useGetSessionTodos(id), { initialProps: 5 });
    await flush();
    await loadTodos(0, TODO_ROWS);
    expect(result.current.todos.length).toBe(4);

    await act(async () => {
      mocks.sessionTodosService.emit('created', { session_id: 5, status: 'pending' });
    });
    await flush();
    expect(mocks.sessionTodosService.find).toHaveBeenCalledTimes(2);
    await loadTodos(1, [
      ...TODO_ROWS,
      { id: 10, ref: 6, sort_order: 2, status: 'pending', title: 'new' },
    ]);
    expect(result.current.todos.length).toBe(5);

    await act(async () => {
      mocks.sessionTodosService.emit('created', { session_id: 999, status: 'pending' });
    });
    await flush();
    expect(mocks.sessionTodosService.find).toHaveBeenCalledTimes(2);
    expect(result.current.todos.length).toBe(5);
  });

  it('removes stale todo events after a session switch', async () => {
    const { result, rerender } = renderHook((id) => useGetSessionTodos(id), { initialProps: 5 });
    await flush();
    await loadTodos(0, TODO_ROWS);
    expect(result.current.todos.length).toBe(4);

    rerender(6);
    expect(result.current.todos).toEqual([]);
    await flush();
    await loadTodos(1, []);
    expect(result.current.todos).toEqual([]);

    await act(async () => {
      mocks.sessionTodosService.emit('patched', { session_id: 5, status: 'pending' }); // stale, session 5
    });
    await flush();
    expect(mocks.sessionTodosService.find).toHaveBeenCalledTimes(2);

    await act(async () => {
      mocks.sessionTodosService.emit('created', { session_id: 6, status: 'pending' }); // current, session 6
    });
    await flush();
    expect(mocks.sessionTodosService.find).toHaveBeenCalledTimes(3);
  });

  it('does not fetch while disabled', async () => {
    const { result, rerender } = renderHook(
      ({ id, enabled }) => useGetSessionTodos(id, { enabled }),
      { initialProps: { id: 5, enabled: false } }
    );
    await flush();
    expect(mocks.sessionTodosService.find).not.toHaveBeenCalled();
    expect(result.current.todos).toEqual([]);
    expect(result.current.loading).toBe(false);

    rerender({ id: 5, enabled: true });
    await flush();
    expect(mocks.sessionTodosService.find).toHaveBeenCalledTimes(1);
  });
});
