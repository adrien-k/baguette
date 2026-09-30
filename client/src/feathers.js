import { feathers } from '@feathersjs/feathers';
import rest from '@feathersjs/rest-client';
import { notifySseReconnect } from './utils/sseReconnect.js';
import { createSseManager } from './utils/sseManager.js';

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

const sseManager = createSseManager({
  url: '/api/events',
  onMessage: ({ data }) => {
    try {
      const { service, event, data: payload } = JSON.parse(data);
      app.service(service).emit(event, payload);
    } catch {
      // ignore malformed messages
    }
  },
  onReconnect: notifySseReconnect,
});
sseManager.start();

/** Close the live event stream and stop lifecycle listeners (e.g. on logout). */
export function clearSseConnectionOnLogout() {
  sseManager.stop();
}

export default app;
export const sessionsService = createService('sessions', {
  customMethods: [
    'stop',
    'commands',
    'diff',
    'changedFiles',
    'sessionGitStatus',
    'getSessionByShortId',
    'sessionUsage',
    'branchCommits',
    'shas',
    'showDiff',
    'merge',
    'setPrDraft',
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
export const usersService = createService('users', {
  customMethods: ['approve', 'reject', 'generateMcpToken', 'revokeMcpToken'],
});
export const pluginsService = createService('admin/plugins', { customMethods: ['refresh'] });
export const slackService = createService('admin/slack', {
  customMethods: ['test'],
});
export const sessionIssuesService = createService('session-issues');
export const sessionReviewMessagesService = createService('session-review-messages');
export const sessionReviewService = createService('session-review', {
  customMethods: ['start', 'stop', 'send', 'reviewNewCommits', 'clearContext'],
});
