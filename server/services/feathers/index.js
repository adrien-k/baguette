import db from '../../db.js';
import sseManager from '../../sse.js';
import { registerMessagesService } from './messages.service.js';
import { registerSessionsService } from './sessions.service.js';
import { registerTasksService } from './tasks.service.js';
import { registerSecretsService } from './secrets.service.js';
import { registerUsersService } from './users.service.js';
import { registerReposService } from './repos.service.js';
import { registerUserReposService } from './user-repos.service.js';
import { registerClaudeAgentService } from './claude-agent.service.js';
import { registerCursorAgentService } from './cursor-agent.service.js';
import { registerPluginsService } from './plugins.service.js';
import { registerQueuedMessagesService } from './queued-messages.service.js';
import { registerRecentCombosService } from './recent-combos.service.js';
const CRUD_EVENTS = ['created', 'updated', 'patched', 'removed'];

/**
 * Register Feathers services and wire their events to SSE connections.
 * Call after app.configure(rest()) and before app.setup(server).
 */
export function registerFeathersServices(app) {
  registerMessagesService(app);
  registerSessionsService(app);
  registerQueuedMessagesService(app);
  registerClaudeAgentService(app);
  registerCursorAgentService(app);
  registerTasksService(app);
  registerSecretsService(app);
  registerUsersService(app);
  registerReposService(app);
  registerUserReposService(app);
  registerPluginsService(app);
  registerRecentCombosService(app);

  // Route service CRUD events to the right SSE connections
  for (const event of CRUD_EVENTS) {
    app.service('sessions').on(event, (data) => {
      if (data?.user_id) sseManager.send(data.user_id, 'sessions', event, data);
    });

    app.service('messages').on(event, async (data) => {
      const session = await db('sessions').where({ id: data.session_id }).first();
      if (session) sseManager.send(session.user_id, 'messages', event, data);
    });

    app.service('tasks').on(event, async (data) => {
      if (!data.session_id) return;
      const session = await db('sessions').where({ id: data.session_id }).first();
      if (session) sseManager.send(session.user_id, 'tasks', event, data);
    });

    app.service('repos').on(event, (data) => {
      sseManager.sendAll('repos', event, data);
    });

    app.service('queued-messages').on(event, (data) => {
      if (data?.user_id) sseManager.send(data.user_id, 'queued-messages', event, data);
    });
  }

  // Transient session-level errors (no replay needed)
  app.service('sessions').on('app:error', (data) => {
    if (data?.user_id) sseManager.send(data.user_id, 'sessions', 'app:error', data);
  });

  app.service('tasks').on('log', async (data) => {
    if (!data.session_id) return;
    const session = await db('sessions').where({ id: data.session_id }).first();
    if (session) sseManager.send(session.user_id, 'tasks', 'log', data);
  });
}
