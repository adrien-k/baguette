/**
 * Query key factory — the single map of every cache entry shape.
 *
 * Keys nest `[domain, kind, ...args]` so invalidation can target a whole
 * domain (`['sessions']`), one kind (`['sessions','list']`), or one entry.
 * React Query hashes keys with sorted object keys, so list-query objects are
 * stable across rebuilds of the same filter.
 */

/** @param {number|string|null|undefined} id */
const idPart = (id) => (id == null ? null : String(id));

export const sessionKeys = {
  all: ['sessions'],
  listsRoot: ['sessions', 'list'],
  /** @param {object} listQuery Feathers query describing the list filter */
  list: (listQuery) => ['sessions', 'list', listQuery ?? {}],
  /** @param {number|string} id */
  detail: (id) => ['sessions', 'detail', idPart(id)],
  /** Live issue/task counts overlay for one session detail. */
  counts: (id) => ['sessions', 'counts', idPart(id)],
};

export const messageKeys = {
  all: ['messages'],
  /** @param {number|string} sessionId @param {number|string|null} agentId */
  session: (sessionId, agentId = null) => ['messages', idPart(sessionId), idPart(agentId)],
};

export const repoKeys = {
  all: ['repos'],
};

export const taskKeys = {
  all: ['tasks'],
  listsRoot: ['tasks', 'list'],
  /** @param {{sessionId?: number|string|null, status?: string|null}} filter */
  list: (filter) => ['tasks', 'list', filter ?? {}],
};

export const currentUserKeys = {
  all: ['current-user'],
  /** @param {number|string} id */
  detail: (id) => ['current-user', idPart(id)],
};

export const branchKeys = {
  all: ['branches'],
  repo: (fullName) => ['branches', 'repo', fullName],
};

export const loopKeys = {
  all: ['loops'],
  list: (query) => ['loops', 'list', query ?? {}],
};

export const agentModelPresetKeys = {
  all: ['agent-model-presets'],
  list: () => ['agent-model-presets', 'list'],
};

export const sessionIssueKeys = {
  all: ['session-issues'],
  session: (sessionId) => ['session-issues', idPart(sessionId)],
};

export const sessionPlanKeys = {
  all: ['session-plans'],
  session: (sessionId) => ['session-plans', idPart(sessionId)],
};

export const sessionTodoKeys = {
  all: ['session-todos'],
  session: (sessionId, openOnly) => ['session-todos', idPart(sessionId), openOnly ? 'open' : 'all'],
};

export const taskLogKeys = {
  all: ['task-logs'],
  task: (taskId) => ['task-logs', idPart(taskId)],
};

export const sessionUsageKeys = {
  all: ['session-usage'],
  session: (sessionId) => ['session-usage', idPart(sessionId)],
};

export const subscriptionLimitsKeys = {
  all: ['subscription-limits'],
  provider: (agentSdk, agentConfigId) => [
    'subscription-limits',
    agentSdk ?? null,
    idPart(agentConfigId),
  ],
};

export const systemInfoKeys = {
  all: ['system-info'],
};

export const usageModelPricingKeys = {
  all: ['usage-model-pricing'],
  list: () => ['usage-model-pricing', 'list'],
};
