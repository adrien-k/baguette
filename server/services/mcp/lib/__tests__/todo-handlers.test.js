import { describe, it, expect } from 'vitest';
import { createTodoHandlers } from '../todo-handlers.js';

function mockApp(todosByRef, { plans = [] } = {}) {
  const store = new Map();
  for (const [ref, row] of Object.entries(todosByRef)) {
    store.set(Number(ref), { ...row, ref: Number(ref), plan_id: row.plan_id ?? null });
  }
  const planStore = plans.map((p) => ({ ...p }));
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
      const row = {
        ...data,
        id,
        ref: data.ref ?? id,
        plan_id: data.plan_id ?? null,
      };
      store.set(row.ref, row);
      return row;
    },
  };
  const sessionPlans = {
    async find({ query }) {
      let rows = planStore.filter((p) => p.session_id === query.session_id);
      if (query.id != null) rows = rows.filter((p) => p.id === query.id);
      if (query.ref != null) rows = rows.filter((p) => p.ref === query.ref);
      if (query.status != null) rows = rows.filter((p) => p.status === query.status);
      const limit = query.$limit ?? rows.length;
      return rows.slice(0, limit);
    },
  };
  return {
    service(name) {
      if (name === 'session-todos') return service;
      if (name === 'session-plans') return sessionPlans;
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

describe('createTodoHandlers createTodo plan_id', () => {
  it('auto-attaches to the agent open current plan when plan_id is omitted', async () => {
    const callerAgent = { id: 20, current_plan_id: 10 };
    const app = mockApp(
      {},
      { plans: [{ id: 10, session_id: 7, ref: 1, status: 'open', markdown: '# P' }] }
    );
    const h = createTodoHandlers(session, app, { callerAgent });
    const result = unwrap(await h.createTodo({ title: 'A', content: 'Body' }));
    expect(result.ok).toBe(true);
    expect(result.todo.plan_id).toBe(10);
  });

  it('uses an explicit plan_id instead of the current plan', async () => {
    const callerAgent = { id: 20, current_plan_id: 10 };
    const app = mockApp(
      {},
      {
        plans: [
          { id: 10, session_id: 7, ref: 1, status: 'open', markdown: '# A' },
          { id: 11, session_id: 7, ref: 2, status: 'open', markdown: '# B' },
        ],
      }
    );
    const h = createTodoHandlers(session, app, { callerAgent });
    const result = unwrap(await h.createTodo({ title: 'A', content: 'Body', plan_id: 11 }));
    expect(result.ok).toBe(true);
    expect(result.todo.plan_id).toBe(11);
  });

  it('does not auto-attach when the current plan is completed', async () => {
    const callerAgent = { id: 20, current_plan_id: 10 };
    const app = mockApp(
      {},
      { plans: [{ id: 10, session_id: 7, ref: 1, status: 'completed', markdown: '# P' }] }
    );
    const h = createTodoHandlers(session, app, { callerAgent });
    const result = unwrap(await h.createTodo({ title: 'A', content: 'Body' }));
    expect(result.ok).toBe(true);
    expect(result.todo.plan_id).toBeNull();
  });
});

describe('createTodoHandlers listTodos plan scope', () => {
  it('scopes to the current open plan including completed todos', async () => {
    const callerAgent = { id: 20, current_plan_id: 10 };
    const app = mockApp(
      {
        1: {
          id: 10,
          session_id: 7,
          plan_id: 10,
          title: 'On plan',
          content: 'Body',
          status: 'pending',
          sort_order: 0,
          created_at: null,
          updated_at: null,
        },
        2: {
          id: 11,
          session_id: 7,
          plan_id: 10,
          title: 'Done on plan',
          content: 'Body 2',
          status: 'completed',
          sort_order: 1,
          created_at: null,
          updated_at: null,
        },
        3: {
          id: 12,
          session_id: 7,
          plan_id: null,
          title: 'Unattached',
          content: 'Body 3',
          status: 'pending',
          sort_order: 2,
          created_at: null,
          updated_at: null,
        },
      },
      { plans: [{ id: 10, session_id: 7, ref: 1, status: 'open', markdown: '# P' }] }
    );
    const h = createTodoHandlers(session, app, { callerAgent });
    const result = unwrap(await h.listTodos());
    expect(result.ok).toBe(true);
    expect(result.todos.map((t) => t.ref)).toEqual([1, 2]);
    expect(result.todos.every((t) => t.plan_id === 10)).toBe(true);
  });
});
