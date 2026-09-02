import db from '../../db.js';
import { GLOBAL_FEATHERS_CHANNEL } from '../../feathers.js';
import { registerMessagesService } from './messages.service.js';
import { registerSessionsService } from './sessions.service.js';
import { registerTasksService } from './tasks.service.js';
import { registerSecretsService } from './secrets.service.js';
import { registerUsersService } from './users.service.js';
import { registerReposService } from './repos.service.js';
import { registerUserReposService } from './user-repos.service.js';
import { registerClaudeAgentService } from './claude-agent.service.js';
import { registerCursorAgentService } from '../cursor-agent.service.js';
import { registerPluginsService } from './plugins.service.js';
import { registerQueuedMessagesService } from './queued-messages.service.js';
import { registerRecentCombosService } from './recent-combos.service.js';

/**
 * Register Feathers services (sessions, messages, tasks), their hooks, and channel publishing.
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

  app.service('sessions').publish((data) => {
    return app.channel(`user/${data.user_id}`);
  });

  app.service('sessions').publish('permission:request', (data) => {
    return app.channel(`user/${data.user_id}`);
  });

  app.service('sessions').publish('permission:handled', (data) => {
    return app.channel(`user/${data.user_id}`);
  });

  app.service('sessions').publish('app:error', (data) => {
    return app.channel(`user/${data.user_id}`);
  });

  app.service('messages').publish(async (data) => {
    const session = await db('sessions').where({ id: data.session_id }).first();
    if (!session) return null;
    return app.channel(`user/${session.user_id}`);
  });

  app.service('tasks').publish(async (data) => {
    if (!data.session_id) return null;
    const session = await db('sessions').where({ id: data.session_id }).first();
    if (!session) return null;
    return app.channel(`user/${session.user_id}`);
  });

  app.service('tasks').publish('log', async (data) => {
    if (!data.session_id) return null;
    const session = await db('sessions').where({ id: data.session_id }).first();
    return session ? app.channel(`user/${session.user_id}`) : null;
  });

  app.service('repos').publish(() => app.channel(GLOBAL_FEATHERS_CHANNEL));

  app.service('queued-messages').publish((data) => {
    return app.channel(`user/${data.user_id}`);
  });
}
