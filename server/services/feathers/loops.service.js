import { KnexService } from '@feathersjs/knex';
import { BadRequest, NotFound } from '@feathersjs/errors';
import { requireUser, scopeByUser, only } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { computeNextRun, normalizeSchedule, parseDaysOfWeek } from '../loop-schedule.js';
import logger from '../../logger.js';

/** Fields a client may set. Everything else (bookkeeping, user_id) is server-owned. */
const WRITABLE_FIELDS = [
  'repo_full_name',
  'name',
  'base_branch',
  'prompt',
  'create_new_branch',
  'auto_push',
  'plan_mode',
  'single_session',
  'permission_mode',
  'agent_sdk',
  'model',
  'model_params',
  'plugins',
  'schedule_type',
  'interval_minutes',
  'time_of_day',
  'days_of_week',
  'timezone',
  'enabled',
];

const SCHEDULE_FIELDS = [
  'schedule_type',
  'interval_minutes',
  'time_of_day',
  'days_of_week',
  'timezone',
];

/**
 * Loops service (table: loops). A loop is a saved session template plus a recurrence; the
 * scheduler asks this service to run the ones that are due, which creates a real session.
 */
export class LoopsService extends KnexService {
  setup(app) {
    this.app = app;
  }

  /**
   * Run every enabled loop whose next_run_at has passed. Sequential: each run spawns an agent
   * session, so firing a backlog in parallel would compete for CPU and API rate limits.
   */
  async runDue(nowMs = Date.now()) {
    const db = this.app.get('db');
    const due = await db('loops')
      .where('enabled', true)
      .whereNotNull('next_run_at')
      .where('next_run_at', '<=', new Date(nowMs).toISOString())
      .orderBy('next_run_at', 'asc');

    const results = [];
    for (const loop of due) {
      results.push(await this.runLoop(loop, nowMs));
    }
    return results;
  }

  /**
   * Fire one loop: re-arm it, then create the session. Re-arming first means a loop whose
   * session creation fails waits for its next slot instead of retrying on every tick.
   */
  async runLoop(loop, nowMs = Date.now()) {
    const service = this.app.service('loops');
    const params = { user: { id: loop.user_id } };
    let nextRunAt = null;
    try {
      nextRunAt = computeNextRun(loopSchedule(loop), nowMs);
    } catch (err) {
      // A row whose recurrence no longer validates would otherwise be picked up forever.
      logger.error({ err, loopId: loop.id }, 'Loop has an invalid schedule — disabling it');
      await service.patch(loop.id, { enabled: false, last_error: err.message }, params);
      return { loop_id: loop.id, error: err.message };
    }
    await service.patch(
      loop.id,
      { last_run_at: new Date(nowMs).toISOString(), next_run_at: nextRunAt },
      params
    );

    try {
      const user = await this.app.service('users').get(loop.user_id, {});
      const outcome = loop.single_session
        ? await this._runInTiedSession(loop, user)
        : { sessionId: (await this._startSession(loop, user)).id };

      if (outcome.skipped) {
        logger.info({ loopId: loop.id }, `Loop run skipped: ${outcome.skipped}`);
        await service.patch(loop.id, { last_error: outcome.skipped }, params);
        return { loop_id: loop.id, skipped: outcome.skipped };
      }

      const patch = { last_session_id: outcome.sessionId, last_error: null };
      if (loop.single_session) patch.session_id = outcome.sessionId;
      await service.patch(loop.id, patch, params);
      logger.info({ loopId: loop.id, sessionId: outcome.sessionId }, 'Loop ran');
      return { loop_id: loop.id, session_id: outcome.sessionId };
    } catch (err) {
      logger.error({ err, loopId: loop.id }, 'Loop run failed');
      await service.patch(loop.id, { last_error: err.message ?? String(err) }, params);
      return { loop_id: loop.id, error: err.message ?? String(err) };
    }
  }

  _startSession(loop, user) {
    return this.app.service('sessions').create(sessionDataFromLoop(loop), { user });
  }

  /**
   * Run a single-session loop: the whole loop lives in one session and worktree, so instead of
   * starting something new we compact what the agent has accumulated and re-send the prompt.
   *
   * Returns `{ sessionId }`, or `{ skipped }` when the session is mid-turn — piling a new run
   * onto a turn that has not finished would interleave two conversations.
   */
  async _runInTiedSession(loop, user) {
    const db = this.app.get('db');
    const tied = loop.session_id
      ? await db('sessions').where({ id: loop.session_id }).first()
      : null;

    // First run, or the session was archived/removed since: start one and tie the loop to it.
    if (!tied || tied.archived_at) {
      return { sessionId: (await this._startSession(loop, user)).id };
    }
    if (BUSY_SESSION_STATUSES.has(tied.status)) {
      return { skipped: 'Previous run was still in progress — skipped this occurrence' };
    }

    const userParams = { user: { id: loop.user_id } };
    const promptMessage = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: loop.prompt },
    });

    // Cursor has no compaction command, so its sessions just get the prompt again.
    if (tied.agent_sdk === 'cursor') {
      await this.app
        .service('messages')
        .create({ session_id: tied.id, type: 'user', message_json: promptMessage }, userParams);
      return { sessionId: tied.id };
    }

    // Queue the prompt before starting compaction, not after: `onTurnComplete` fires as soon as
    // the compaction turn ends, and a fast (or failed) compaction would otherwise finish first
    // and leave the prompt sitting in the queue until some unrelated turn released it.
    const queued = await this.app
      .service('queued-messages')
      .create({ session_id: tied.id, message_json: promptMessage }, userParams);
    try {
      await this.app.service('messages').create(
        {
          session_id: tied.id,
          type: 'user',
          subtype: 'baguette',
          // `source: 'baguette'` makes the chat collapse this into a Baguette block rather than
          // showing it as something the user typed.
          message_json: JSON.stringify({
            type: 'user',
            source: 'baguette',
            message: { role: 'user', content: '/compact' },
            title: 'Loop run — compacting the conversation',
          }),
        },
        userParams
      );
    } catch (err) {
      // Nothing will release the queued prompt, so take it back out rather than let it surprise
      // the user during their next turn.
      await this.app
        .service('queued-messages')
        .remove(queued.id, userParams)
        .catch(() => {});
      throw err;
    }
    return { sessionId: tied.id };
  }
}

/** A session in one of these is mid-turn: it cannot take a loop run right now. */
const BUSY_SESSION_STATUSES = new Set(['running', 'approval']);

function loopSchedule(loop) {
  return {
    type: loop.schedule_type,
    interval_minutes: loop.interval_minutes,
    time_of_day: loop.time_of_day,
    days_of_week: parseDaysOfWeek(loop.days_of_week),
    timezone: loop.timezone,
  };
}

/** The `sessions.create` payload for one run of `loop`. */
function sessionDataFromLoop(loop) {
  const data = {
    loop_id: loop.id,
    repo_full_name: loop.repo_full_name,
    base_branch: loop.base_branch,
    initial_prompt: loop.prompt,
    permission_mode: loop.permission_mode || 'bypassPermissions',
    plan_mode: !!loop.plan_mode,
    create_new_branch: !!loop.create_new_branch,
    auto_push: !!loop.auto_push,
  };
  if (loop.agent_sdk) data.agent_sdk = loop.agent_sdk;
  if (loop.model) data.model = loop.model;
  if (loop.model_params) data.model_params = loop.model_params;
  const plugins = parseJsonArray(loop.plugins);
  if (plugins?.length) data.plugins = plugins;
  return data;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function applySchedule(data, schedule) {
  data.schedule_type = schedule.type;
  data.interval_minutes = schedule.interval_minutes;
  data.time_of_day = schedule.time_of_day;
  data.days_of_week = schedule.days_of_week ? JSON.stringify(schedule.days_of_week) : null;
  data.timezone = schedule.timezone;
}

function normalizeSchedulePayload(input) {
  try {
    return normalizeSchedule(input);
  } catch (err) {
    throw new BadRequest(err.message);
  }
}

function serializePlugins(context) {
  const { plugins } = context.data;
  if (Array.isArray(plugins)) context.data.plugins = JSON.stringify(plugins);
  else if (plugins === null) context.data.plugins = null;
  else if (plugins === undefined) delete context.data.plugins;
  return context;
}

async function resolveRepo(context) {
  const fullName = context.data.repo_full_name;
  if (!fullName) throw new BadRequest('repo_full_name is required');
  const repo = await context.app.get('db')('repos').where({ full_name: fullName }).first();
  if (!repo) throw new NotFound(`Unknown repository "${fullName}"`);
  context.data.repo_id = repo.id;
  return context;
}

function normalizeCreate(context) {
  const data = context.data;
  if (!data.base_branch) throw new BadRequest('base_branch is required');
  if (!data.prompt?.trim()) throw new BadRequest('prompt is required');

  applySchedule(data, normalizeSchedulePayload(data));
  data.enabled = data.enabled === undefined ? true : !!data.enabled;
  data.create_new_branch = data.create_new_branch === undefined ? true : !!data.create_new_branch;
  data.auto_push = data.auto_push === undefined ? true : !!data.auto_push;
  data.plan_mode = !!data.plan_mode;
  data.single_session = !!data.single_session;
  data.next_run_at = data.enabled ? computeNextRun(loopSchedule(data)) : null;
  return context;
}

/**
 * Verify ownership before patching or removing, and drop the SELECT builder `scopeByUser` left
 * on params — `_patch` would consume it for its UPDATE and then find no rows to return.
 */
async function requireOwnLoop(context) {
  const userId = context.params.user?.id;
  if (context.id == null) throw new BadRequest('Loop id is required');
  const loop = await context.app
    .get('db')('loops')
    .where(userId ? { id: context.id, user_id: userId } : { id: context.id })
    .first();
  if (!loop) throw new NotFound('Loop not found');
  context.params.existingLoop = loop;
  delete context.params.knex;
  return context;
}

function normalizePatch(context) {
  const data = context.data;
  const existing = context.params.existingLoop;

  if ('prompt' in data && !data.prompt?.trim()) throw new BadRequest('prompt is required');
  for (const field of [
    'enabled',
    'create_new_branch',
    'auto_push',
    'plan_mode',
    'single_session',
  ]) {
    if (field in data) data[field] = !!data[field];
  }
  // Turning single-session off frees the loop from the session it was pinned to; turning it on
  // starts a new one on the next run rather than adopting whatever ran last.
  if ('single_session' in data && data.single_session !== !!existing.single_session) {
    data.session_id = null;
  }

  const scheduleTouched = SCHEDULE_FIELDS.some((f) => f in data);
  if (scheduleTouched) {
    applySchedule(
      data,
      normalizeSchedulePayload({ ...loopSchedule(existing), ...scheduleAlias(data) })
    );
  }

  // Re-arm whenever the recurrence or the on/off switch moves; a disabled loop has no next run.
  const enabled = 'enabled' in data ? data.enabled : !!existing.enabled;
  if (scheduleTouched || 'enabled' in data) {
    data.next_run_at = enabled ? computeNextRun(loopSchedule({ ...existing, ...data })) : null;
  }
  data.updated_at = new Date().toISOString();
  return context;
}

/** Map the flat `schedule_*` patch fields onto the shape `normalizeSchedule` reads. */
function scheduleAlias(data) {
  const out = {};
  if ('schedule_type' in data) out.type = data.schedule_type;
  for (const field of ['interval_minutes', 'time_of_day', 'days_of_week', 'timezone']) {
    if (field in data) out[field] = data[field];
  }
  return out;
}

/** JSON columns back to arrays, SQLite integers back to booleans. */
function formatLoop(loop) {
  if (!loop) return loop;
  return {
    ...loop,
    days_of_week: parseDaysOfWeek(loop.days_of_week),
    plugins: parseJsonArray(loop.plugins) ?? [],
    enabled: !!loop.enabled,
    create_new_branch: !!loop.create_new_branch,
    auto_push: !!loop.auto_push,
    plan_mode: !!loop.plan_mode,
    single_session: !!loop.single_session,
  };
}

function formatResult(context) {
  const result = context.result;
  if (!result) return context;
  if (Array.isArray(result?.data))
    context.result = { ...result, data: result.data.map(formatLoop) };
  else if (Array.isArray(result)) context.result = result.map(formatLoop);
  else context.result = formatLoop(result);
  return context;
}

async function orderByNewestFirst(context) {
  // Build on the query `scopeByUser` left behind — a fresh one would drop the user scoping.
  const query = context.params.knex ?? context.service.createQuery(context.params);
  context.params.knex = query.orderBy('created_at', 'desc');
  return context;
}

export const loopsHooks = {
  before: {
    all: [requireUser],
    find: [scopeByUser, orderByNewestFirst],
    get: [scopeByUser],
    create: [only(WRITABLE_FIELDS), scopeByUser, resolveRepo, serializePlugins, normalizeCreate],
    patch: [scopeByUser, requireOwnLoop, only(WRITABLE_FIELDS), serializePlugins, normalizePatch],
    remove: [scopeByUser, requireOwnLoop],
  },
  after: {
    find: [formatResult],
    get: [formatResult],
    create: [formatResult],
    patch: [formatResult],
    remove: [formatResult],
  },
};

export function registerLoopsService(app, path = 'loops') {
  const options = {
    Model: app.get('db'),
    name: 'loops',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new LoopsService(options), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
  });
  app.service(path).hooks(loopsHooks);
}
