/** Pending and in_progress — open work for unattached composer todos. */
export const COMPOSER_OPEN_TODO_STATUSES = new Set(['pending', 'in_progress']);

export function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * @param {Array<{ id: number, status?: string }>} plans
 * @param {number | null | undefined} currentPlanId
 * @returns {object | null} open plan row when the agent is attached to an open plan
 */
export function resolveOpenCurrentPlan(plans, currentPlanId) {
  const id = parsePositiveInt(currentPlanId);
  if (id == null) return null;
  const plan = plans.find((p) => p.id === id) ?? null;
  if (!plan || plan.status !== 'open') return null;
  return plan;
}

/**
 * Todos shown in the chat composer drawer for the selected agent.
 *
 * @param {Array<{ plan_id?: number | null, status?: string }>} todos sorted session todos
 * @param {{ currentPlanId?: number | null, plans?: Array<{ id: number, status?: string }> }} context
 */
export function filterComposerSessionTodos(todos, { currentPlanId, plans = [] } = {}) {
  const plan = resolveOpenCurrentPlan(plans, currentPlanId);
  if (plan) {
    return todos.filter((t) => t.plan_id === plan.id);
  }
  return todos.filter((t) => t.plan_id == null && COMPOSER_OPEN_TODO_STATUSES.has(t.status));
}
