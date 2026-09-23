import express from '@feathersjs/express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import logger from './logger.js';
import { SDK_QUERY_CLOSED_MESSAGE } from './claude-agent-sdk-constants.js';
import { createAuthRoutes } from './routes/auth.js';
import { PUBLIC_HOST, ENCRYPTION_KEY } from './config.js';
import createSettingsRoutes from './routes/settings.js';
import createImagesRoutes from './routes/images.js';
import { createRequireAuth } from './middleware/auth.js';
import { createFeathersApp, cookieAuthMiddleware } from './feathers.js';
import { registerFeathersServices } from './services/feathers/index.js';
import { startScheduledQueuedMessageSender } from './services/scheduled-queued-messages.js';
import { DevProxy } from './services/dev-proxy.js';
import { CodeServerHandler } from './services/codeserver-handler.js';
import { DevserverHandler } from './services/devserver-handler.js';
import { SseManager } from './lib/sse-manager.js';
import db from './db.js';

const { rest } = express;

process.on('unhandledRejection', (reason) => {
  if (
    reason &&
    typeof reason === 'object' &&
    'message' in reason &&
    reason.message === SDK_QUERY_CLOSED_MESSAGE
  ) {
    logger.debug({ err: reason }, 'Ignored Claude agent SDK query-close rejection');
    return;
  }
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = createFeathersApp();
const feathersSse = new SseManager();

app.set('db', db);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
const server = createServer(app);

const devProxy = new DevProxy(app, [CodeServerHandler, DevserverHandler]);
app.set('devProxy', devProxy);

// Kamal health check
app.get('/up', (req, res) => {
  res.send('OK');
});

app.use(cookieParser(ENCRYPTION_KEY));

// Subdomain proxies — run before auth and body parsers so POST bodies are not
// consumed before being piped to the underlying process.
app.use(devProxy.middleware);

app.use(express.json({ strict: false }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieAuthMiddleware(app));

const requireAuth = createRequireAuth(app);
app.use(createSettingsRoutes(requireAuth));
app.use(createAuthRoutes(app));
app.use(createImagesRoutes());

// SSE endpoint for real-time server→client events
app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const userId = req.user.id;
  feathersSse.subscribe(req, res, userId);
});

// Dev only: redirect GET / to the frontend dev server (e.g. Vite)
if (process.env.VITE_SERVER_ENABLED === 'true') {
  app.get('/', (req, res) => {
    res.redirect(PUBLIC_HOST);
  });
}

if (process.env.VITE_SERVER_ENABLED !== 'true') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  // Serve static routes before turning /api/* routes into Feathers services
  // to avoid any conflict.
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.url.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Strip /api prefix so Feathers services are accessible at /api/<name>
// (existing /api/* Express routes above are already handled and won't reach here)
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) req.url = '/' + req.url.slice(5);
  next();
});
app.configure(rest());
registerFeathersServices(app, feathersSse);

app.hooks({
  error: {
    all: [
      async (context) => {
        const error = context.error;

        // Log full error internally
        if (!error.code || error.code >= 500) {
          logger.error(error, 'Feathers error hook');
        }

        return context;
      },
    ],
  },
});

app.use(express.errorHandler());
// Sessions interrupted by the last shutdown are resumed once every service is set up — the
// restart path dispatches through the agent services, which need their own setup() to have run.
app.setup(server).then(
  async () => {
    startScheduledQueuedMessageSender(app);
    await app.service('sessions').restartInterruptedSessions();
  },
  (err) => logger.error({ err }, 'App setup failed')
);

// WebSocket proxy for session subdomains — no Socket.IO to forward to.
server.on('upgrade', (req, socket, head) => devProxy.handleUpgrade(req, socket, head));

const PORT = process.env.PORT || 3000;
// Preview proxy health-checks 127.0.0.1. Binding `::` in dev can make those
// checks fail (IPv6-only) so the preview never leaves "starting".
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
server.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST }, 'Server running');
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down');
  try {
    await app.service('tasks').killAllTasks();
  } catch (err) {
    logger.error({ err }, 'Error while stopping tasks');
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
