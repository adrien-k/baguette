import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';
import { collectLastFailedTasks } from '../lib/task-helpers.js';
import { notifyParentAgentIds } from '../../agents-db.js';
import { agentFailureError, hydrateAgentFailureErrors } from '../../agent-error-message.js';

/** Task statuses that mean "the child process is alive or draining". */
const RUNNING_TASK_STATUSES = ['running', 'waiting', 'exiting'];

const TODO_STATUSES = ['pending', 'in_progress', 'completed'];

function lastMessagePointer(row) {
  if (!row) return null;
  return {
    id: row.id,
    turn_id: row.turn_id,
    type: row.type,
    created_at: row.created_at,
  };
}

function queuedMessageCounts(rows, primaryAgentId) {
  let primaryTurn = 0;
  let scheduled = 0;
  for (const row of rows) {
    if (row.kind === 'scheduled') {
      scheduled++;
      continue;
    }
    if (row.agent_id === primaryAgentId) primaryTurn++;
  }
  return {
    total: rows.length,
    primary_count: primaryTurn,
    scheduled_count: scheduled,
  };
}

export function createGetSessionStatusTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'GetSessionStatus',
    description:
      'Cheap progress snapshot of one session: agent statuses (running/approval/stopped/completed/failed), error_message when an agent failed, queued-message counts, last message pointers, running/failed tasks, and todo/plan rollup. ' +
      'Prefer this over GetSession for progress checks — it avoids fetching message bodies. ' +
      'Use GetAgentMessages when you need message bodies. ' +
      'Identify the session by session_id (from SearchSessions or CreateSession).',
    schema: {
      session_id: z.number().int().describe('Session numeric id'),
    },
    handler: async ({ session_id }) => {
      if (session_id == null) {
        return fail('Provide session_id');
      }
      const { session, error } = await requireOwnedSessionById(app, session_id, userId);
      if (!session) return fail(error);

      const db = app.get('db');
      const agents = await db('agents').where({ session_id }).orderBy('id', 'asc');
      await hydrateAgentFailureErrors(db, agents);
      const primary = agents.find((agent) => agent.is_primary === 1) ?? null;
      const primaryAgentId = primary?.id ?? null;
      const watching = await notifyParentAgentIds(
        db,
        agents.map((agent) => agent.id)
      );

      const queuedRows = await db('queued_messages')
        .where({ session_id })
        .select('agent_id', 'kind');
      const queued_messages = queuedMessageCounts(queuedRows, primaryAgentId);

      let last_message = { user: null, assistant: null };
      if (primaryAgentId != null) {
        const lastUser = await db('session_messages')
          .where({ session_id, agent_id: primaryAgentId, type: 'user' })
          .orderBy('id', 'desc')
          .first();
        const lastAssistant = await db('session_messages')
          .where({ session_id, agent_id: primaryAgentId, type: 'assistant' })
          .orderBy('id', 'desc')
          .first();
        last_message = {
          user: lastMessagePointer(lastUser),
          assistant: lastMessagePointer(lastAssistant),
        };
      }

      const tasksService = app.service('tasks');
      let running_tasks = [];
      let last_failed_tasks = [];
      if (tasksService?.listTasksForSession) {
        running_tasks = tasksService
          .listTasksForSession(session_id, { limit: 20 })
          .filter((task) => RUNNING_TASK_STATUSES.includes(task.status))
          .map((task) => ({
            task_id: task.id,
            task_key: task.task_key,
            label: task.label,
            status: task.status,
          }));
        last_failed_tasks = collectLastFailedTasks(tasksService, session_id);
      }

      const todoRows = await db('session_todos').where({ session_id }).select('status');
      const todos = { pending: 0, in_progress: 0, completed: 0 };
      for (const row of todoRows) {
        if (TODO_STATUSES.includes(row.status)) todos[row.status]++;
      }
      const openPlan = await db('session_plans')
        .where({ session_id, status: 'open' })
        .orderBy('id', 'desc')
        .first();

      return ok({
        session,
        primary_agent_id: primaryAgentId,
        agents: agents.map((agent) => ({
          ref: agent.ref,
          name: agent.name,
          agent_type: agent.agent_type,
          is_primary: Boolean(agent.is_primary),
          status: agent.status,
          error_message: agentFailureError(agent),
          active_turn_id: agent.active_turn_id,
          notify_parent: watching.has(agent.id),
          model: agent.model,
          created_at: agent.created_at,
          updated_at: agent.updated_at,
        })),
        queued_messages,
        last_message,
        running_tasks,
        last_failed_tasks,
        todos,
        plan: openPlan
          ? {
              id: openPlan.id,
              ref: openPlan.ref ?? null,
              status: openPlan.status,
              created_at: openPlan.created_at,
              updated_at: openPlan.updated_at,
            }
          : null,
      });
    },
  };
}
