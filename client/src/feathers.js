import { feathers } from 'feathers';
import { fetchClient } from 'feathers/client';
import { notifySseReconnect } from './utils/sseReconnect.js';
import { configureSsePauseAndReconnect } from './utils/sseClientLifecycle.js';

const fetchWithCreds = (url, init) => window.fetch(url, { credentials: 'include', ...init });

const app = feathers();
app.configure(
  fetchClient(fetchWithCreds, {
    baseUrl: `${window.location.origin}/api`,
    sse: 'sse',
  })
);

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

function createService(path) {
  const svc = app.service(path);
  svc.hooks(noAutoEmit);
  return svc;
}

let hadSseOpen = false;
let sseStoppedForLogout = false;
/** @type {AbortController | null} */
let sseAbortController = null;

const sseService = app.service('sse');
sseService.on('connected', (controller) => {
  sseAbortController = controller;
  if (hadSseOpen) {
    if (document.visibilityState !== 'hidden' && navigator.onLine) {
      notifySseReconnect();
    }
  } else {
    hadSseOpen = true;
  }
});

const sseLifecycle = configureSsePauseAndReconnect({
  app,
  getAbortController: () => sseAbortController,
  clearAbortController: () => {
    sseAbortController = null;
  },
  shouldConnect: () => !sseStoppedForLogout,
});
sseLifecycle.start();

void app.setup();

/** Close the live event stream and stop lifecycle listeners (e.g. on logout). */
export function clearSseConnectionOnLogout() {
  sseStoppedForLogout = true;
  sseLifecycle.stop();
  sseAbortController?.abort();
  sseAbortController = null;
}

export const sessionsService = createService('sessions');
export const messagesService = createService('messages');
export const agentsService = createService('agents');
export const tasksService = createService('tasks');
export const reposService = createService('repos');
export const userReposService = createService('user-repos');
export const secretsService = createService('secrets');
export const queuedMessagesService = createService('queued-messages');
export const loopsService = createService('loops');
export const usersService = createService('users');
export const usageModelPricingService = createService('usage-model-pricing');
export const usageService = createService('usage');
export const pluginsService = createService('admin/plugins');
export const slackService = createService('admin/slack');
export const sessionIssuesService = createService('session-issues');
export const sessionTodosService = createService('session-todos');
export const sessionPlansService = createService('session-plans');
export const agentModelPresetsService = createService('agent-model-presets');
export const agentConfigsService = createService('agent-configs');
