import { feathers } from '@feathersjs/feathers';
import rest from '@feathersjs/rest-client';

const app = feathers();
app.configure(rest(`${window.location.origin}/api`).fetch(window.fetch.bind(window)));

// SSE for real-time server→client events
const eventSource = new EventSource('/api/events', { withCredentials: true });
eventSource.onmessage = ({ data }) => {
  try {
    const { service, event, data: payload } = JSON.parse(data);
    app.service(service).emit(event, payload);
  } catch {
    // ignore malformed messages
  }
};

export default app;
export const sessionsService = app.service('sessions');
sessionsService.methods('stop', 'commands', 'diff', 'shas', 'showDiff', 'merge', 'push', 'restore', 'getPrDetails');

export const recentCombosService = app.service('recent-combos');
export const messagesService = app.service('messages');
export const tasksService = app.service('tasks');
tasksService.methods('kill', 'logs');

export const reposService = app.service('repos');
reposService.methods(
  'findRemote',
  'findOrgs',
  'branches',
  'configure',
  'refresh',
  'findAll',
  'unlink',
  'createLocal'
);

export const userReposService = app.service('user-repos');
export const secretsService = app.service('secrets');
export const queuedMessagesService = app.service('queued-messages');
export const usersService = app.service('users');
usersService.methods('approve', 'reject');
export const pluginsService = app.service('admin/plugins');
pluginsService.methods('refresh');
