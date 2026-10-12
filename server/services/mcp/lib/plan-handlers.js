import { BadRequest, NotFound } from '@feathersjs/errors';
import { ok, fail } from './result.js';
import { applySessionPlanPatches } from '../../session-plan-patch.js';

function serviceError(err) {
  if (err instanceof BadRequest) return fail(err.message);
  if (err instanceof NotFound) return fail('Plan not found');
  throw err;
}

async function getPlanRow(app, sessionId, userId) {
  const result = await app.service('session-plans').find({
    query: { session_id: sessionId, $limit: 1 },
    paginate: false,
    user: { id: userId },
  });
  const rows = Array.isArray(result) ? result : (result?.data ?? []);
  return rows[0] ?? null;
}

export function createPlanHandlers(session, app) {
  const userId = session.user_id;
  const sessionId = session.id;
  const userParams = { user: { id: userId } };

  return {
    async createPlan({ markdown }) {
      try {
        const text = markdown != null ? String(markdown).trim() : '';
        if (!text) return fail('markdown is required');
        const existing = await getPlanRow(app, sessionId, userId);
        if (existing) return fail('A plan already exists for this session; use EditPlan');
        const row = await app
          .service('session-plans')
          .create({ session_id: sessionId, markdown: text }, userParams);
        return ok({ markdown: row.markdown });
      } catch (err) {
        return serviceError(err);
      }
    },

    async editPlan({ patches }) {
      try {
        const existing = await getPlanRow(app, sessionId, userId);
        if (!existing) return fail('No plan yet; use CreatePlan');
        const text = applySessionPlanPatches(existing.markdown, patches);
        const row = await app
          .service('session-plans')
          .patch(existing.id, { markdown: text }, userParams);
        return ok({ markdown: row.markdown });
      } catch (err) {
        return serviceError(err);
      }
    },

    async readPlan() {
      try {
        const existing = await getPlanRow(app, sessionId, userId);
        if (!existing) return fail('No plan yet; use CreatePlan');
        return ok({ markdown: existing.markdown });
      } catch (err) {
        return serviceError(err);
      }
    },
  };
}
