import { isFeathersBadRequest, isFeathersNotFound } from '../../../lib/feathers-errors.js';
import { sortSessionTodosAsc } from '../../../../shared/session-todo-sort.js';
import { ok, fail } from './result.js';
import { serializeTodo, OPEN_TODO_STATUSES } from '../../session-todos.js';

function serviceError(err) {
  if (isFeathersBadRequest(err)) return fail(err.message);
  if (isFeathersNotFound(err)) return fail('Todo not found');
  throw err;
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

async function findSessionPlan(app, sessionId, userId, extraQuery = {}) {
  const result = await app.service('session-plans').find({
    query: { session_id: sessionId, $limit: 1, ...extraQuery },
    paginate: false,
    user: { id: userId },
  });
  const rows = Array.isArray(result) ? result : (result?.data ?? []);
  return rows[0] ?? null;
}

async function getOpenCurrentPlan(app, sessionId, userId, callerAgent) {
  const currentPlanId = parsePositiveInt(callerAgent?.current_plan_id);
  if (currentPlanId == null) return null;
  const plan = await findSessionPlan(app, sessionId, userId, { id: currentPlanId });
  if (!plan || plan.status !== 'open') return null;
  return plan;
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

async function listTodosForHandler(app, sessionId, userId, callerAgent, { openOnly } = {}) {
  let todos = await listTodosForSession(app, sessionId, userId);
  const plan = await getOpenCurrentPlan(app, sessionId, userId, callerAgent);
  if (plan) {
    todos = todos.filter((t) => t.plan_id === plan.id);
  }
  if (openOnly) {
    todos = todos.filter((t) => OPEN_TODO_STATUSES.includes(t.status));
  }
  return todos;
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

export function createTodoHandlers(session, app, { callerAgent = null } = {}) {
  const userId = session.user_id;
  const sessionId = session.id;
  const userParams = { user: { id: userId } };

  return {
    async createTodo({ title, content, plan_id } = {}) {
      try {
        const payload = {
          session_id: sessionId,
          title,
          content,
          status: 'pending',
        };
        if (plan_id !== undefined) {
          payload.plan_id = plan_id;
        } else {
          const current = await getOpenCurrentPlan(app, sessionId, userId, callerAgent);
          if (current) payload.plan_id = current.id;
        }
        const row = await app.service('session-todos').create(payload, userParams);
        const todo = serializeTodo(row);
        const todos = await listTodosForHandler(app, sessionId, userId, callerAgent, {
          openOnly: true,
        });
        return ok({ todo, todos });
      } catch (err) {
        return serviceError(err);
      }
    },

    async updateTodo({ ref, status, title, content, plan_id } = {}) {
      try {
        const todoRef = parseRef(ref);
        if (todoRef == null) return fail('Invalid todo ref');
        if (
          status === undefined &&
          title === undefined &&
          content === undefined &&
          plan_id === undefined
        ) {
          return fail('Pass at least one of status, title, or content to update');
        }
        const existing = await findTodoByRef(app, sessionId, todoRef, userId);
        if (!existing) return fail('Todo not found');
        const patch = {};
        if (status !== undefined) patch.status = status;
        if (title !== undefined) patch.title = title;
        if (content !== undefined) patch.content = content;
        if (plan_id !== undefined) patch.plan_id = plan_id;
        const row = await app.service('session-todos').patch(existing.id, patch, userParams);
        const todo = serializeTodo(row);
        const todos = await listTodosForHandler(app, sessionId, userId, callerAgent, {
          openOnly: true,
        });
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
        const todos = await listTodosForHandler(app, sessionId, userId, callerAgent, {
          openOnly: true,
        });
        return ok({ deleted, todos });
      } catch (err) {
        return serviceError(err);
      }
    },

    async listTodos() {
      try {
        const todos = await listTodosForHandler(app, sessionId, userId, callerAgent);
        return ok({ todos });
      } catch (err) {
        return serviceError(err);
      }
    },
  };
}
