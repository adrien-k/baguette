import { isFeathersBadRequest, isFeathersNotFound } from '../../../lib/feathers-errors.js';
import { ok, fail } from './result.js';
import { applySessionPlanPatches } from '../../session-plan-patch.js';

function serviceError(err) {
  if (isFeathersBadRequest(err)) return fail(err.message);
  if (isFeathersNotFound(err)) return fail('Plan not found');
  throw err;
}

function serializePlan(row) {
  return {
    id: row.id,
    ref: row.ref,
    status: row.status,
    markdown: row.markdown,
  };
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function planRows(result) {
  return Array.isArray(result) ? result : (result?.data ?? []);
}

async function findSessionPlan(app, sessionId, userId, extraQuery = {}) {
  const result = await app.service('session-plans').find({
    query: { session_id: sessionId, $limit: 1, ...extraQuery },
    paginate: false,
    user: { id: userId },
  });
  return planRows(result)[0] ?? null;
}

const NO_CURRENT_PLAN =
  'No current plan for this agent; pass plan_id or ref from ListPlans, or call StartPlan after CreatePlan';

const PLAN_STATUSES = ['open', 'completed'];

async function resolvePlan(app, sessionId, userId, { plan_id, ref, currentPlanId } = {}) {
  if (plan_id != null) {
    const planId = parsePositiveInt(plan_id);
    if (planId == null) return { error: 'Invalid plan_id' };
    const row = await findSessionPlan(app, sessionId, userId, { id: planId });
    if (!row) return { error: 'Plan not found' };
    return { row };
  }
  if (ref != null) {
    const planRef = parsePositiveInt(ref);
    if (planRef == null) return { error: 'Invalid plan ref' };
    const row = await findSessionPlan(app, sessionId, userId, { ref: planRef });
    if (!row) return { error: 'Plan not found' };
    return { row };
  }
  const fallbackId = parsePositiveInt(currentPlanId);
  if (fallbackId == null) return { error: NO_CURRENT_PLAN };
  const row = await findSessionPlan(app, sessionId, userId, { id: fallbackId });
  if (!row) return { error: 'Plan not found' };
  return { row };
}

export function createPlanHandlers(session, app, { callerAgent = null } = {}) {
  const userId = session.user_id;
  const sessionId = session.id;
  const userParams = { user: { id: userId } };

  return {
    async createPlan({ markdown }) {
      try {
        const text = markdown != null ? String(markdown).trim() : '';
        if (!text) return fail('markdown is required');
        const row = await app
          .service('session-plans')
          .create({ session_id: sessionId, markdown: text }, userParams);
        return ok(serializePlan(row));
      } catch (err) {
        return serviceError(err);
      }
    },

    async startPlan({ plan_id, ref } = {}) {
      try {
        if (!callerAgent?.id) return fail('No calling agent');
        if (plan_id == null && ref == null) return fail('Pass plan_id or ref');
        const resolved = await resolvePlan(app, sessionId, userId, { plan_id, ref });
        if (resolved.error) return fail(resolved.error);
        const plan = resolved.row;
        if (plan.status === 'completed') return fail('Plan is completed');
        if (callerAgent.current_plan_id === plan.id) {
          return ok({ ...serializePlan(plan), current_plan_id: plan.id });
        }
        await app.service('agents').patch(callerAgent.id, { current_plan_id: plan.id }, userParams);
        callerAgent.current_plan_id = plan.id;
        return ok({ ...serializePlan(plan), current_plan_id: plan.id });
      } catch (err) {
        return serviceError(err);
      }
    },

    async editPlan({ patches, plan_id, ref } = {}) {
      try {
        const resolved = await resolvePlan(app, sessionId, userId, {
          plan_id,
          ref,
          currentPlanId: callerAgent?.current_plan_id,
        });
        if (resolved.error) return fail(resolved.error);
        const text = applySessionPlanPatches(resolved.row.markdown, patches);
        const row = await app
          .service('session-plans')
          .patch(resolved.row.id, { markdown: text }, userParams);
        return ok(serializePlan(row));
      } catch (err) {
        return serviceError(err);
      }
    },

    async readPlan({ plan_id, ref } = {}) {
      try {
        const resolved = await resolvePlan(app, sessionId, userId, {
          plan_id,
          ref,
          currentPlanId: callerAgent?.current_plan_id,
        });
        if (resolved.error) return fail(resolved.error);
        return ok(serializePlan(resolved.row));
      } catch (err) {
        return serviceError(err);
      }
    },

    async listPlans({ status } = {}) {
      try {
        const query = { session_id: sessionId, $sort: { ref: 1 } };
        if (status != null) {
          if (!PLAN_STATUSES.includes(status)) {
            return fail(`status must be one of: ${PLAN_STATUSES.join(', ')}`);
          }
          query.status = status;
        }
        const result = await app.service('session-plans').find({
          query,
          paginate: false,
          user: { id: userId },
        });
        return ok({
          plans: planRows(result).map(serializePlan),
          current_plan_id: callerAgent?.current_plan_id ?? null,
        });
      } catch (err) {
        return serviceError(err);
      }
    },

    async completePlan({ plan_id, ref } = {}) {
      try {
        const resolved = await resolvePlan(app, sessionId, userId, {
          plan_id,
          ref,
          currentPlanId: callerAgent?.current_plan_id,
        });
        if (resolved.error) return fail(resolved.error);
        const row = await app
          .service('session-plans')
          .patch(resolved.row.id, { status: 'completed' }, userParams);
        if (callerAgent?.current_plan_id === row.id) {
          callerAgent.current_plan_id = null;
        }
        return ok(serializePlan(row));
      } catch (err) {
        return serviceError(err);
      }
    },
  };
}
