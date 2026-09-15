import { feathers } from '@feathersjs/feathers';
import rest from '@feathersjs/rest-client';

const app = feathers();
app.configure(rest(`${window.location.origin}/api`).fetch(window.fetch.bind(window)));

// SSE is the sole source of real-time events; suppress the REST client's
// auto-emit so mutating calls don't fire a duplicate event before SSE arrives.
const suppressClientEvent = (context) => { context.event = null; };
const noAutoEmit = { after: { create: [suppressClientEvent], patch: [suppressClientEvent], remove: [suppressClientEvent] } };

function createService(path, { methods = [], customMethods = [] } = {}) {
  const svc = app.service(path);
  if (customMethods.length) svc.methods(...customMethods);
  svc.hooks(noAutoEmit);
  return svc;
}

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
export const sessionsService = createService('sessions', {
  customMethods: ['stop', 'commands', 'diff', 'shas', 'showDiff', 'merge', 'push', 'restore', 'getPrDetails'],
});
export const messagesService = createService('messages');
export const tasksService = createService('tasks', { customMethods: ['kill', 'logs'] });
export const reposService = createService('repos', {
  customMethods: ['findRemote', 'findOrgs', 'branches', 'configure', 'refresh', 'findAll', 'unlink', 'createLocal'],
});
export const userReposService = createService('user-repos');
export const secretsService = createService('secrets');
export const queuedMessagesService = createService('queued-messages');
export const usersService = createService('users', { customMethods: ['approve', 'reject'] });
export const pluginsService = createService('admin/plugins', { customMethods: ['refresh'] });
