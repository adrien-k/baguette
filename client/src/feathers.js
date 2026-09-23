import { feathers } from '@feathersjs/feathers';
import rest from '@feathersjs/rest-client';
import {
  dismissConnectionToast,
  showConnectionLostToast,
  showConnectionRestoredToast,
} from './utils/connectionToast.jsx';
import { watchSseConnection } from './utils/sseConnectionWatcher.js';

const app = feathers();
app.configure(rest(`${window.location.origin}/api`).fetch(window.fetch.bind(window)));

// SSE is the sole source of real-time events; suppress the REST client's
// auto-emit so mutating calls don't fire a duplicate event before SSE arrives.
const suppressClientEvent = (context) => {
  context.event = null;
};
const noAutoEmit = {
  after: {
    create: [suppressClientEvent],
    patch: [suppressClientEvent],
    remove: [suppressClientEvent],
  },
};

function createService(path, { customMethods = [] } = {}) {
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

// Real-time updates are invisible when the stream drops, so tell the user.
const sseConnection = watchSseConnection(eventSource, {
  onLost: showConnectionLostToast,
  onRestored: showConnectionRestoredToast,
});

/** Dismiss connection toasts and stop treating the next SSE close as a user-visible outage. */
export function clearSseConnectionOnLogout() {
  dismissConnectionToast();
  sseConnection.onLogout();
}

export default app;
export const sessionsService = createService('sessions', {
  customMethods: [
    'stop',
    'commands',
    'diff',
    'gitStatus',
    'shas',
    'showDiff',
    'merge',
    'push',
    'restore',
    'getPrDetails',
    'previewStatus',
    'startPreviewService',
  ],
});
export const messagesService = createService('messages');
export const tasksService = createService('tasks', { customMethods: ['kill', 'logs'] });
export const reposService = createService('repos', {
  customMethods: [
    'findRemote',
    'findOrgs',
    'branches',
    'configure',
    'refresh',
    'findAll',
    'unlink',
    'createLocal',
  ],
});
export const userReposService = createService('user-repos');
export const secretsService = createService('secrets');
export const queuedMessagesService = createService('queued-messages', {
  customMethods: ['schedule'],
});
export const loopsService = createService('loops');
export const usersService = createService('users', { customMethods: ['approve', 'reject'] });
export const pluginsService = createService('admin/plugins', { customMethods: ['refresh'] });
