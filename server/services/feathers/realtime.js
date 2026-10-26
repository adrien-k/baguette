import { AbortableSseService } from '../../lib/abortable-sse-service.js';
import db from '../../db.js';
import { requireUser } from './hooks.js';

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

async function channelForSessionOwner(app, sessionId) {
  if (!sessionId) return null;
  const session = await db('sessions').where({ id: sessionId }).first();
  if (!session?.user_id) return null;
  return app.channel(`user/${session.user_id}`);
}

function channelForUserId(app, userId) {
  if (!userId) return null;
  return app.channel(`user/${userId}`);
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
      const channel = channelForUserId(app, data?.user_id);
      if (!channel) return null;
      return channel.send(stripSessionShortId(data));
    });

    app
      .service('messages')
      .publish(event, async (data) => channelForSessionOwner(app, data?.session_id));

    app.service('agents').publish(event, async (data) => {
      if (!data?.session_id) return null;
      return channelForSessionOwner(app, data.session_id);
    });

    app.service('tasks').publish(event, async (data) => {
      if (!data?.session_id) return null;
      return channelForSessionOwner(app, data.session_id);
    });

    app.service('repos').publish(event, () => app.channel('authenticated'));

    app.service('queued-messages').publish(event, (data) => channelForUserId(app, data?.user_id));

    app.service('loops').publish(event, (data) => channelForUserId(app, data?.user_id));

    app.service('session-issues').publish(event, async (data) => {
      if (!data?.session_id) return null;
      return channelForSessionOwner(app, data.session_id);
    });

    app.service('session-todos').publish(event, async (data) => {
      if (!data?.session_id) return null;
      return channelForSessionOwner(app, data.session_id);
    });

    app.service('session-plans').publish(event, async (data) => {
      if (!data?.session_id) return null;
      return channelForSessionOwner(app, data.session_id);
    });
  }

  for (const event of SESSION_USER_EVENTS) {
    app.service('sessions').publish(event, (data) => channelForUserId(app, data?.user_id));
  }

  app
    .service('users')
    .publish('github:bad-credentials', (data) => channelForUserId(app, data?.user_id));

  app.service('tasks').publish('log', async (data) => {
    if (!data?.session_id) return null;
    return channelForSessionOwner(app, data.session_id);
  });
}
