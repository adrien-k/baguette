import { AbortableSseService } from '../../lib/abortable-sse-service.js';
import db from '../../db.js';
import { requireUser } from './hooks.js';
import { loadSessionForPublish } from './shared-access.js';

const CRUD_EVENTS = ['created', 'updated', 'patched', 'removed'];

const SESSION_USER_EVENTS = [
  'app:error',
  'turn:start',
  'turn:complete',
  'push:start',
  'push:complete',
];

/** `short_id` is internal — never sent to clients over SSE. */
function stripSessionShortId(data) {
  if (!data || typeof data !== 'object' || data.short_id == null) return data;
  const { short_id: _shortId, ...rest } = data;
  return rest;
}

/**
 * `last_viewed_at` is per-viewer (session_user_state). Broadcasting the
 * triggering user's value would overwrite every other client's unread state.
 */
function stripViewerLastViewed(data) {
  if (!data || typeof data !== 'object' || !('last_viewed_at' in data)) return data;
  const { last_viewed_at: _lastViewedAt, ...rest } = data;
  return rest;
}

function stripShareNotify(data) {
  if (!data || typeof data !== 'object' || data._was_shared == null) return data;
  const { _was_shared: _wasShared, ...rest } = data;
  return rest;
}

/** Unshare is broadcast to every authenticated user — send only enough to drop the item. */
function unsharePublicPayload(data) {
  return { id: data.id, user_id: data.user_id, is_shared: data.is_shared };
}

function sessionPublishPayload(data) {
  if (data?._was_shared) return unsharePublicPayload(data);
  return stripViewerLastViewed(stripShareNotify(stripSessionShortId(data)));
}

function loopPublishPayload(data) {
  if (data?._was_shared) return unsharePublicPayload(data);
  return stripShareNotify(data);
}

function channelForUserId(app, userId) {
  if (!userId) return null;
  return app.channel(`user/${userId}`);
}

function channelsForOwnedOrShared(app, record) {
  if (record?.is_shared || record?._was_shared) {
    return app.channel('authenticated');
  }
  return channelForUserId(app, record?.user_id);
}

async function channelsForSessionId(app, sessionId) {
  const session = await loadSessionForPublish(db, sessionId);
  if (!session) return null;
  return channelsForOwnedOrShared(app, session);
}

/**
 * Built-in SSE service, connection channels, and event publishers.
 * Call after all other services are registered and before app.setup(server).
 */
export function registerFeathersRealtime(app) {
  app.use('sse', new AbortableSseService(), { methods: ['find'] });
  app.service('sse').hooks({
    before: {
      find: [requireUser],
    },
  });

  app.publish(() => null);

  app.on('connection', (connection) => {
    const userId = connection.user?.id;
    if (!userId) return;
    app.channel('authenticated').join(connection);
    app.channel(`user/${userId}`).join(connection);
  });

  app.on('disconnect', (connection) => {
    if (!app.channels.length) return;
    app.channel(app.channels).leave(connection);
  });

  for (const event of CRUD_EVENTS) {
    app.service('sessions').publish(event, (data) => {
      const channel = channelsForOwnedOrShared(app, data);
      if (!channel) return null;
      return channel.send(sessionPublishPayload(data));
    });

    app
      .service('messages')
      .publish(event, async (data) => channelsForSessionId(app, data?.session_id));

    app.service('agents').publish(event, async (data) => {
      if (!data?.session_id) return null;
      return channelsForSessionId(app, data.session_id);
    });

    app.service('tasks').publish(event, async (data) => {
      if (!data?.session_id) return null;
      return channelsForSessionId(app, data.session_id);
    });

    app.service('repos').publish(event, () => app.channel('authenticated'));

    app.service('queued-messages').publish(event, async (data) => {
      if (data?.session_id) return channelsForSessionId(app, data.session_id);
      return channelForUserId(app, data?.user_id);
    });

    app.service('loops').publish(event, (data) => {
      const channel = channelsForOwnedOrShared(app, data);
      if (!channel) return null;
      const payload = loopPublishPayload(data);
      return payload === data ? channel : channel.send(payload);
    });

    app.service('session-issues').publish(event, async (data) => {
      if (!data?.session_id) return null;
      return channelsForSessionId(app, data.session_id);
    });

    app.service('session-todos').publish(event, async (data) => {
      if (!data?.session_id) return null;
      return channelsForSessionId(app, data.session_id);
    });

    app.service('session-plans').publish(event, async (data) => {
      if (!data?.session_id) return null;
      return channelsForSessionId(app, data.session_id);
    });
  }

  for (const event of SESSION_USER_EVENTS) {
    app.service('sessions').publish(event, async (data) => {
      const sessionId = data?.session_id ?? data?.sessionId;
      if (sessionId != null) return channelsForSessionId(app, sessionId);
      return channelsForOwnedOrShared(app, data);
    });
  }

  app
    .service('users')
    .publish('github:bad-credentials', (data) => channelForUserId(app, data?.user_id));

  app.service('tasks').publish('log', async (data) => {
    if (!data?.session_id) return null;
    return channelsForSessionId(app, data.session_id);
  });
}
