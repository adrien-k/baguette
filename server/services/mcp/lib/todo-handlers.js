import { BadRequest, NotFound } from '@feathersjs/errors';
import { ok, fail } from './result.js';
import { serializeTodo, OPEN_TODO_STATUSES } from '../../session-todos.js';

function serviceError(err) {
  if (err instanceof BadRequest) return fail(err.message);
  if (err instanceof NotFound) return fail('Todo not found');
  throw err;
}

async function listTodosForSession(app, sessionId, userId) {
  const result = await app.service('session-todos').find({
    query: { session_id: sessionId, $sort: { sort_order: 1, ref: 1 }, $limit: 500 },
    paginate: false,
    user: { id: userId },
  });
  const rows = Array.isArray(result) ? result : (result?.data ?? []);
  return rows.map(serializeTodo);
}

async function listOpenTodos(app, sessionId, userId) {
  const all = await listTodosForSession(app, sessionId, userId);
  return all.filter((t) => OPEN_TODO_STATUSES.includes(t.status));
}

function parseRef(ref) {
  const n = Number(ref);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

async function findTodoByRef(app, sessionId, ref, userId) {
  const result = await app.service('session-todos').find({
    query: { session_id: sessionId, ref, $limit: 1 },
    paginate: false,
    user: { id: userId },
  });
  const rows = Array.isArray(result) ? result : (result?.data ?? []);
  return rows[0] ?? null;
}

export function createTodoHandlers(session, app) {
  const userId = session.user_id;
  const sessionId = session.id;
  const userParams = { user: { id: userId } };

  return {
    async createTodo({ content }) {
      try {
        const row = await app.service('session-todos').create(
          {
            session_id: sessionId,
            content,
            status: 'pending',
          },
          userParams
        );
        const todo = serializeTodo(row);
        const todos = await listOpenTodos(app, sessionId, userId);
        return ok({ todo, todos });
      } catch (err) {
        return serviceError(err);
      }
    },

    async processTodo({ ref }) {
      try {
        const todoRef = parseRef(ref);
        if (todoRef == null) return fail('Invalid todo ref');
        const existing = await findTodoByRef(app, sessionId, todoRef, userId);
        if (!existing) return fail('Todo not found');
        const row = await app
          .service('session-todos')
          .patch(existing.id, { status: 'in_progress' }, userParams);
        const todo = serializeTodo(row);
        const todos = await listOpenTodos(app, sessionId, userId);
        return ok({ todo, todos });
      } catch (err) {
        return serviceError(err);
      }
    },

    async completeTodo({ ref }) {
      try {
        const todoRef = parseRef(ref);
        if (todoRef == null) return fail('Invalid todo ref');
        const existing = await findTodoByRef(app, sessionId, todoRef, userId);
        if (!existing) return fail('Todo not found');
        const row = await app
          .service('session-todos')
          .patch(existing.id, { status: 'completed' }, userParams);
        const todo = serializeTodo(row);
        const todos = await listOpenTodos(app, sessionId, userId);
        return ok({ todo, todos });
      } catch (err) {
        return serviceError(err);
      }
    },

    async listTodos() {
      try {
        const todos = await listOpenTodos(app, sessionId, userId);
        return ok({ todos });
      } catch (err) {
        return serviceError(err);
      }
    },
  };
}
