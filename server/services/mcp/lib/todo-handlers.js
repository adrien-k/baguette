import { BadRequest, NotFound } from '@feathersjs/errors';
import { sortSessionTodosAsc } from '../../../../shared/session-todo-sort.js';
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
  return sortSessionTodosAsc(rows.map(serializeTodo));
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
    async createTodo({ title, content }) {
      try {
        const row = await app.service('session-todos').create(
          {
            session_id: sessionId,
            title,
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

    async updateTodo({ ref, status, title, content }) {
      try {
        const todoRef = parseRef(ref);
        if (todoRef == null) return fail('Invalid todo ref');
        if (status === undefined && title === undefined && content === undefined) {
          return fail('Pass at least one of status, title, or content to update');
        }
        const existing = await findTodoByRef(app, sessionId, todoRef, userId);
        if (!existing) return fail('Todo not found');
        const patch = {};
        if (status !== undefined) patch.status = status;
        if (title !== undefined) patch.title = title;
        if (content !== undefined) patch.content = content;
        const row = await app.service('session-todos').patch(existing.id, patch, userParams);
        const todo = serializeTodo(row);
        const todos = await listOpenTodos(app, sessionId, userId);
        return ok({ todo, todos });
      } catch (err) {
        return serviceError(err);
      }
    },

    async deleteTodos({ refs }) {
      try {
        const rawRefs = Array.isArray(refs) ? refs : [];
        const uniqueRefs = [];
        for (const raw of rawRefs) {
          const todoRef = parseRef(raw);
          if (todoRef == null) return fail('Invalid todo ref');
          if (!uniqueRefs.includes(todoRef)) uniqueRefs.push(todoRef);
        }
        if (uniqueRefs.length === 0) return fail('Pass at least one todo ref to delete');

        const toDelete = [];
        for (const todoRef of uniqueRefs) {
          const existing = await findTodoByRef(app, sessionId, todoRef, userId);
          if (!existing) return fail(`Todo not found: #${todoRef}`);
          toDelete.push(existing);
        }
        const deleted = [];
        for (const existing of toDelete) {
          deleted.push(serializeTodo(existing));
          await app.service('session-todos').remove(existing.id, userParams);
        }
        const todos = await listOpenTodos(app, sessionId, userId);
        return ok({ deleted, todos });
      } catch (err) {
        return serviceError(err);
      }
    },

    async listTodos() {
      try {
        const todos = await listTodosForSession(app, sessionId, userId);
        return ok({ todos });
      } catch (err) {
        return serviceError(err);
      }
    },
  };
}
