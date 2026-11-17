import { KnexService } from '@feathersjs/knex';
import { BadRequest, NotFound } from 'feathers/errors';
import { requireUser } from './hooks.js';
import { getPrimaryBuilderAgent, insertAgentObserver } from '../agents-db.js';

/**
 * Turn-end observer subscriptions (`agent_observers` table).
 *
 * Exposes only the two custom methods — `watch` (subscribe the calling agent to a
 * target session's primary builder) and `unwatch` (remove the caller's rows). There
 * is deliberately no `find`/`get`: reads go through the `agents-db.js` helpers
 * internally, and a generic unscoped read would leak cross-user observation
 * metadata. The service is also absent from `PUBLIC_SERVICES`, so the external
 * transports reject it entirely.
 */
class AgentObserversService extends KnexService {
  setup(app) {
    this.app = app;
  }

  async watch(data, params) {
    const db = this.app.get('db');
    const userId = params.user?.id;
    const sessionId = Number(data?.session_id);
    if (!Number.isFinite(sessionId)) throw new BadRequest('session_id is required');
    const observerSessionId = Number(data?.observer_session_id);
    if (!Number.isFinite(observerSessionId))
      throw new BadRequest('observer_session_id is required');
    const observerAgentId = Number(data?.observer_agent_id);
    if (!Number.isFinite(observerAgentId)) throw new BadRequest('observer_agent_id is required');

    // v1 ownership: caller must own both the observed and the observer session.
    let observerSession = null;
    for (const id of [sessionId, observerSessionId]) {
      const session = await db('sessions').where({ id, user_id: userId }).first();
      if (!session) throw new NotFound(`Session ${id} not found`);
      if (id === observerSessionId) observerSession = session;
    }
    // Cross-session observation is the global orchestrator workflow — a repo session
    // cannot watch the sessions it creates (or any other session).
    if (!observerSession?.is_global) {
      throw new BadRequest(
        'Only global sessions can observe other sessions — session watching is the global orchestrator workflow.'
      );
    }
    const observerAgent = await db('agents')
      .where({ id: observerAgentId, session_id: observerSessionId })
      .first();
    if (!observerAgent) throw new NotFound('Observer agent not found');
    const observed = await getPrimaryBuilderAgent(db, sessionId);
    if (!observed) throw new NotFound('Session has no primary builder to observe');

    const rowId = await insertAgentObserver(db, {
      agentId: observed.id,
      observerAgentId,
      notifyOn: data?.notify_on,
    });
    return {
      ok: true,
      observed_agent_id: observed.id,
      observer_agent_id: observerAgentId,
      observer_session_id: observerSessionId,
      notify_on: data?.notify_on ?? 'turn_end',
      row_id: rowId,
    };
  }

  async unwatch(data, params) {
    const db = this.app.get('db');
    const userId = params.user?.id;
    const sessionId = Number(data?.session_id);
    if (!Number.isFinite(sessionId)) throw new BadRequest('session_id is required');
    const observerSessionId = Number(data?.observer_session_id);
    if (!Number.isFinite(observerSessionId))
      throw new BadRequest('observer_session_id is required');

    for (const id of [sessionId, observerSessionId]) {
      const session = await db('sessions').where({ id, user_id: userId }).first();
      if (!session) throw new NotFound(`Session ${id} not found`);
    }
    const observed = await getPrimaryBuilderAgent(db, sessionId);
    if (!observed) throw new NotFound('Session has no primary builder to observe');

    // Remove every observer row the caller's session holds for this observed agent
    // (any agent in the observer session may have subscribed).
    const observerAgentIds = await db('agents')
      .where({ session_id: observerSessionId })
      .pluck('id');
    const removed = observerAgentIds.length
      ? await db('agent_observers')
          .where({ agent_id: observed.id })
          .whereIn('observer_agent_id', observerAgentIds)
          .delete()
      : 0;
    return { ok: true, removed };
  }
}

export function registerAgentObserversService(app, path = 'agent-observers') {
  const options = {
    Model: app.get('db'),
    name: 'agent_observers',
    id: 'id',
    paginate: { default: 50, max: 500 },
  };
  app.use(path, new AgentObserversService(options), {
    methods: ['watch', 'unwatch'],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser],
      watch: [],
      unwatch: [],
    },
  });
}
