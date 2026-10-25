import { describe, it, expect } from 'vitest';
import { createTodoHandlers } from '../todo-handlers.js';

function mockApp(todosByRef) {
  const store = new Map();
  for (const [ref, row] of Object.entries(todosByRef)) {
    store.set(Number(ref), { ...row, ref: Number(ref) });
  }
  let nextId = 100;
  const service = {
    async find({ query }) {
      const ref = query?.ref;
      const rows = [...store.values()].filter((r) => {
        if (ref != null && r.ref !== ref) return false;
        if (query?.session_id != null && r.session_id !== query.session_id) return false;
        return true;
      });
      return rows;
    },
    async patch(id, data) {
      const row = [...store.values()].find((r) => r.id === id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    async remove(id) {
      for (const [ref, row] of store.entries()) {
        if (row.id === id) {
          store.delete(ref);
          return row;
        }
      }
      throw new Error('not found');
    },
    async create(data) {
      const id = nextId++;
      const row = { id, ...data };
      store.set(row.ref, row);
      return row;
    },
  };
  return {
    service(name) {
      if (name === 'session-todos') return service;
      throw new Error(`unknown service ${name}`);
    },
    _store: store,
  };
}

const session = { id: 7, user_id: 3 };

function unwrap(result) {
  return JSON.parse(result.content[0].text);
}

describe('createTodoHandlers updateTodo', () => {
  it('requires at least one field to update', async () => {
    const app = mockApp({
      1: {
        id: 10,
        session_id: 7,
        title: 'T',
        content: 'Body',
        status: 'pending',
        sort_order: 0,
        created_at: null,
        updated_at: null,
      },
    });
    const h = createTodoHandlers(session, app);
    const result = unwrap(await h.updateTodo({ ref: 1 }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/at least one/i);
  });

  it('patches status and returns open todos', async () => {
    const app = mockApp({
      1: {
        id: 10,
        session_id: 7,
        title: 'T',
        content: 'Body',
        status: 'pending',
        sort_order: 0,
        created_at: null,
        updated_at: null,
      },
      2: {
        id: 11,
        session_id: 7,
        title: 'Other',
        content: 'Open',
        status: 'in_progress',
        sort_order: 1,
        created_at: null,
        updated_at: null,
      },
    });
    const h = createTodoHandlers(session, app);
    const result = unwrap(await h.updateTodo({ ref: 1, status: 'completed' }));
    expect(result.ok).toBe(true);
    expect(result.todo.status).toBe('completed');
    expect(result.todos.map((t) => t.ref)).toEqual([2]);
  });
});

describe('createTodoHandlers listTodos', () => {
  it('returns todos in every status', async () => {
    const app = mockApp({
      1: {
        id: 10,
        session_id: 7,
        title: 'Open',
        content: 'Body',
        status: 'pending',
        sort_order: 0,
        created_at: null,
        updated_at: null,
      },
      2: {
        id: 11,
        session_id: 7,
        title: 'Done',
        content: 'Body 2',
        status: 'completed',
        sort_order: 1,
        created_at: null,
        updated_at: null,
      },
    });
    const h = createTodoHandlers(session, app);
    const result = unwrap(await h.listTodos());
    expect(result.ok).toBe(true);
    expect(result.todos.map((t) => t.status).sort()).toEqual(['completed', 'pending']);
  });
});

describe('createTodoHandlers deleteTodos', () => {
  it('deletes multiple refs and dedupes', async () => {
    const app = mockApp({
      1: {
        id: 10,
        session_id: 7,
        title: 'Done',
        content: 'Body',
        status: 'completed',
        sort_order: 0,
        created_at: null,
        updated_at: null,
      },
      2: {
        id: 11,
        session_id: 7,
        title: 'Also done',
        content: 'Body 2',
        status: 'completed',
        sort_order: 1,
        created_at: null,
        updated_at: null,
      },
    });
    const h = createTodoHandlers(session, app);
    const result = unwrap(await h.deleteTodos({ refs: [1, 1, 2] }));
    expect(result.ok).toBe(true);
    expect(result.deleted.map((t) => t.ref)).toEqual([1, 2]);
    expect(result.todos).toEqual([]);
    expect(app._store.size).toBe(0);
  });

  it('fails when a ref is missing', async () => {
    const app = mockApp({});
    const h = createTodoHandlers(session, app);
    const result = unwrap(await h.deleteTodos({ refs: [9] }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/#9/);
  });

  it('does not delete any refs when one ref in the batch is missing', async () => {
    const app = mockApp({
      1: {
        id: 10,
        session_id: 7,
        title: 'A',
        content: 'Body',
        status: 'completed',
        sort_order: 0,
        created_at: null,
        updated_at: null,
      },
      2: {
        id: 11,
        session_id: 7,
        title: 'B',
        content: 'Body 2',
        status: 'completed',
        sort_order: 1,
        created_at: null,
        updated_at: null,
      },
    });
    const h = createTodoHandlers(session, app);
    const result = unwrap(await h.deleteTodos({ refs: [1, 2, 9] }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/#9/);
    expect(app._store.size).toBe(2);
  });
});
