import {
  sessionsService,
  agentsService,
  messagesService,
  reposService,
  tasksService,
  sessionIssuesService,
  usersService,
  loopsService,
  sessionPlansService,
  sessionTodosService,
  agentModelPresetsService,
} from '../feathers.js';
import {
  sessionKeys,
  messageKeys,
  repoKeys,
  taskKeys,
  currentUserKeys,
  loopKeys,
  agentModelPresetKeys,
  sessionIssueKeys,
  sessionPlanKeys,
  sessionTodoKeys,
} from './keys.js';
import { runAfterReconnectResync } from './reconnectResync.js';
import { getRealtimeScope } from './realtimeScope.js';
import {
  applyAgentEventToDetail,
  applyAgentEventToInfiniteList,
  applyAgentRemoveToDetail,
  applyAgentRemoveToInfiniteList,
  applySessionEventToDetail,
  applySessionEventToInfiniteList,
  removeSessionFromInfiniteList,
  sessionMatchesList,
} from './sessionCacheUpdaters.js';
import {
  applyMessageEventToInfiniteMessages,
  messageEventMatchesKey,
} from './messageCacheUpdaters.js';
import { applyTaskEventToFilteredRows } from './taskCacheUpdaters.js';
import { applyIssueEventToRows } from './issueCacheUpdaters.js';

/**
 * Central SSE → QueryClient cache bridge.
 *
 * Subscribes once to Feathers service events (delivered over the SSE stream)
 * and writes event payloads straight into the query cache, replacing per-hook
 * listener wiring. Hooks for migrated services no longer attach their own
 * listeners; entries for unmounted views keep updating silently.
 */

/**
 * Run `update(data, queryKey)` over every cached entry under `keyRoot`.
 * (v5 `setQueriesData` updaters receive no query/key argument, so iterate
 * matching queries explicitly.)
 */
function updateMatchingEntries(queryClient, keyRoot, update) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: keyRoot })) {
    queryClient.setQueryData(query.queryKey, (data) => update(data, query.queryKey));
  }
}

/** Run `update(data, listQuery)` over every cached sessions list entry. */
function updateSessionListEntries(queryClient, update) {
  updateMatchingEntries(queryClient, sessionKeys.listsRoot, (data, queryKey) => {
    if (!data?.pages) return data;
    const listQuery = queryKey[2] ?? {};
    return update(data, listQuery);
  });
}

function upsertSessionEvent(queryClient, session) {
  if (!session?.id) return;
  updateSessionListEntries(queryClient, (data, listQuery) => {
    const matches = (row) => sessionMatchesList(listQuery, row, getRealtimeScope());
    return applySessionEventToInfiniteList(data, session, matches);
  });
  updateMatchingEntries(queryClient, ['sessions', 'detail'], (prev) =>
    applySessionEventToDetail(prev, session)
  );
}

function removeSessionEvent(queryClient, session) {
  if (!session?.id) return;
  // Removal is unconditional by id (parity with the previous hook behavior): a
  // deleted session must leave every list regardless of filter state.
  updateSessionListEntries(queryClient, (data) => removeSessionFromInfiniteList(data, session.id));
  queryClient.removeQueries({ queryKey: sessionKeys.detail(session.id) });
  queryClient.removeQueries({ queryKey: sessionKeys.counts(session.id) });
}

function applyAgentPatchEvent(queryClient, agent) {
  if (!agent?.session_id) return;
  updateSessionListEntries(queryClient, (data) => applyAgentEventToInfiniteList(data, agent));
  updateMatchingEntries(queryClient, ['sessions', 'detail'], (prev) =>
    applyAgentEventToDetail(prev, agent)
  );
}

// Agent creation arrives as the full row — the patch merge appends it to the
// session's embedded `agents` (sidebar agent tree shows new subagents live).
function applyAgentRemoveEvent(queryClient, agent) {
  if (!agent?.session_id) return;
  updateSessionListEntries(queryClient, (data) => applyAgentRemoveToInfiniteList(data, agent));
  updateMatchingEntries(queryClient, ['sessions', 'detail'], (prev) =>
    applyAgentRemoveToDetail(prev, agent)
  );
}

function upsertMessageEvent(queryClient, message) {
  if (!message?.id) return;
  updateMatchingEntries(queryClient, messageKeys.all, (data, queryKey) => {
    const [, keySessionId, keyAgentId] = queryKey;
    if (!messageEventMatchesKey(keySessionId, keyAgentId, message)) return data;
    return applyMessageEventToInfiniteMessages(data, message);
  });
}

/** Invalidate a detail's live issue/task counts when a row for it changes. */
function invalidateSessionCounts(queryClient, row) {
  const sessionId = row?.session_id;
  if (sessionId == null) return;
  queryClient.invalidateQueries({ queryKey: sessionKeys.counts(sessionId), refetchType: 'active' });
}

function taskEvent(queryClient, task, event) {
  if (!task?.id) return;
  updateMatchingEntries(queryClient, taskKeys.listsRoot, (rows, queryKey) => {
    if (!Array.isArray(rows)) return rows;
    const filter = queryKey[2] ?? {};
    return applyTaskEventToFilteredRows(rows, task, event, filter);
  });
  invalidateSessionCounts(queryClient, task);
}

/** A user patch is the full updated row; merge it into any cached user detail. */
function applyUserPatchEvent(queryClient, user) {
  if (user?.id == null) return;
  updateMatchingEntries(queryClient, currentUserKeys.all, (prev, queryKey) => {
    const [, keyId] = queryKey;
    if (String(keyId) !== String(user.id)) return prev;
    return { ...prev, ...user };
  });
}

function issueEvent(queryClient, issue, event) {
  if (!issue?.id) return;
  updateMatchingEntries(queryClient, sessionIssueKeys.all, (rows, queryKey) => {
    const [, keySessionId] = queryKey;
    if (keySessionId == null || !sameSessionId(keySessionId, issue.session_id)) return rows;
    return applyIssueEventToRows(rows, issue, event);
  });
  invalidateSessionCounts(queryClient, issue);
}

/** Row-scoped services the hooks treat as “refetch on any change” (invalidate). */
function invalidateSessionScoped(queryClient, keyRoot, sessionId) {
  if (sessionId == null) return;
  void queryClient.invalidateQueries({
    queryKey: [keyRoot[0], String(sessionId)],
    refetchType: 'active',
  });
}

function planEvent(queryClient, plan) {
  invalidateSessionScoped(queryClient, sessionPlanKeys.all, plan?.session_id);
}

function todoEvent(queryClient, todo) {
  invalidateSessionScoped(queryClient, sessionTodoKeys.all, todo?.session_id);
}

function loopEvent(queryClient) {
  void queryClient.invalidateQueries({ queryKey: loopKeys.all, refetchType: 'active' });
}

/** Preset events carry the full enriched row — upsert/remove it in cached lists. */
function upsertPresetEvent(queryClient, preset) {
  if (!preset?.id) return;
  updateMatchingEntries(queryClient, agentModelPresetKeys.all, (rows) => {
    if (!Array.isArray(rows)) return rows;
    const index = rows.findIndex((row) => row.id === preset.id);
    if (index === -1) return [...rows, preset];
    const next = rows.slice();
    next[index] = { ...next[index], ...preset };
    return next;
  });
}

function removePresetEvent(queryClient, preset) {
  if (!preset?.id) return;
  updateMatchingEntries(queryClient, agentModelPresetKeys.all, (rows) => {
    if (!Array.isArray(rows)) return rows;
    return rows.filter((row) => row.id !== preset.id);
  });
}

function sameSessionId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

/**
 * Attach the bridge to `queryClient`. Returns a stop function that detaches
 * every listener (useful for tests).
 */
export function startSseCacheBridge(queryClient) {
  // While a reconnect reload is in flight, hold events and apply them onto the
  // server snapshot. Applying them immediately loses to that snapshot.
  const live =
    (fn) =>
    (...args) =>
      runAfterReconnectResync(() => fn(...args));

  const onSessionUpsert = live((session) => upsertSessionEvent(queryClient, session));
  const onSessionRemove = live((session) => removeSessionEvent(queryClient, session));
  const onAgentPatch = live((agent) => applyAgentPatchEvent(queryClient, agent));
  const onAgentRemove = live((agent) => applyAgentRemoveEvent(queryClient, agent));
  const onMessageUpsert = live((message) => upsertMessageEvent(queryClient, message));
  const onRepoChange = live(() => {
    void queryClient.invalidateQueries({ queryKey: repoKeys.all, refetchType: 'active' });
  });
  const onTaskCreated = live((task) => taskEvent(queryClient, task, 'created'));
  const onTaskPatched = live((task) => taskEvent(queryClient, task, 'patched'));
  const onTaskRemoved = live((task) => taskEvent(queryClient, task, 'removed'));
  const onUserPatched = live((user) => applyUserPatchEvent(queryClient, user));
  const onIssueCreated = live((issue) => issueEvent(queryClient, issue, 'created'));
  const onIssuePatched = live((issue) => issueEvent(queryClient, issue, 'patched'));
  const onIssueRemoved = live((issue) => issueEvent(queryClient, issue, 'removed'));
  const onPlanChange = live((plan) => planEvent(queryClient, plan));
  const onTodoChange = live((todo) => todoEvent(queryClient, todo));
  const onLoopChange = live(() => loopEvent(queryClient));
  const onPresetChange = live((preset) => upsertPresetEvent(queryClient, preset));
  const onPresetRemove = live((preset) => removePresetEvent(queryClient, preset));

  sessionsService.on('created', onSessionUpsert);
  sessionsService.on('updated', onSessionUpsert);
  sessionsService.on('patched', onSessionUpsert);
  sessionsService.on('removed', onSessionRemove);
  agentsService.on('created', onAgentPatch);
  agentsService.on('patched', onAgentPatch);
  agentsService.on('removed', onAgentRemove);
  messagesService.on('created', onMessageUpsert);
  messagesService.on('patched', onMessageUpsert);
  reposService.on('created', onRepoChange);
  reposService.on('removed', onRepoChange);
  tasksService.on('created', onTaskCreated);
  tasksService.on('patched', onTaskPatched);
  tasksService.on('removed', onTaskRemoved);
  usersService.on('patched', onUserPatched);
  // Issue events invalidate the counts overlay inside `issueEvent` — no
  // separate counts listener (tasks likewise route through `taskEvent`).
  sessionIssuesService.on('created', onIssueCreated);
  sessionIssuesService.on('patched', onIssuePatched);
  sessionIssuesService.on('removed', onIssueRemoved);
  sessionPlansService.on('created', onPlanChange);
  sessionPlansService.on('patched', onPlanChange);
  sessionPlansService.on('removed', onPlanChange);
  sessionTodosService.on('created', onTodoChange);
  sessionTodosService.on('patched', onTodoChange);
  sessionTodosService.on('removed', onTodoChange);
  loopsService.on('created', onLoopChange);
  loopsService.on('patched', onLoopChange);
  loopsService.on('removed', onLoopChange);
  agentModelPresetsService.on('created', onPresetChange);
  agentModelPresetsService.on('patched', onPresetChange);
  agentModelPresetsService.on('removed', onPresetRemove);

  return () => {
    sessionsService.off('created', onSessionUpsert);
    sessionsService.off('updated', onSessionUpsert);
    sessionsService.off('patched', onSessionUpsert);
    sessionsService.off('removed', onSessionRemove);
    agentsService.off('created', onAgentPatch);
    agentsService.off('patched', onAgentPatch);
    agentsService.off('removed', onAgentRemove);
    messagesService.off('created', onMessageUpsert);
    messagesService.off('patched', onMessageUpsert);
    reposService.off('created', onRepoChange);
    reposService.off('removed', onRepoChange);
    tasksService.off('created', onTaskCreated);
    tasksService.off('patched', onTaskPatched);
    tasksService.off('removed', onTaskRemoved);
    usersService.off('patched', onUserPatched);
    sessionIssuesService.off('created', onIssueCreated);
    sessionIssuesService.off('patched', onIssuePatched);
    sessionIssuesService.off('removed', onIssueRemoved);
    sessionPlansService.off('created', onPlanChange);
    sessionPlansService.off('patched', onPlanChange);
    sessionPlansService.off('removed', onPlanChange);
    sessionTodosService.off('created', onTodoChange);
    sessionTodosService.off('patched', onTodoChange);
    sessionTodosService.off('removed', onTodoChange);
    loopsService.off('created', onLoopChange);
    loopsService.off('patched', onLoopChange);
    loopsService.off('removed', onLoopChange);
    agentModelPresetsService.off('created', onPresetChange);
    agentModelPresetsService.off('patched', onPresetChange);
    agentModelPresetsService.off('removed', onPresetRemove);
  };
}
