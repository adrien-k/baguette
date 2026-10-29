import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHandler, errorHandler, queryParser, bodyParser } from 'feathers/http';
import { toAbortableNodeHandler } from './lib/feathers-node-handler.js';
import { getClientIp } from './lib/client-ip.js';

import logger from './logger.js';
import { SDK_QUERY_CLOSED_MESSAGE } from './claude-agent-sdk-constants.js';
import { createAuthRoutes } from './routes/auth.js';
import { PUBLIC_HOST, ENCRYPTION_KEY } from './config.js';
import createSettingsRoutes from './routes/settings.js';
import createMcpRoutes from './routes/mcp.js';
import createImagesRoutes from './routes/images.js';
import createSlackRoutes from './routes/slack.js';
import { createSlackBot } from './services/slack-bot.js';
import { createSlackSocketManager } from './services/slack-socket.js';
import { createRequireAuth } from './middleware/auth.js';
import { createFeathersApp, cookieAuthMiddleware } from './feathers.js';
import { registerFeathersServices } from './services/feathers/index.js';
import {
  registerAppErrorHandler,
  handleAppError,
  createExpressErrorHandler,
} from './lib/app-error-handler.js';
import { createFeathersCookieAuth } from './lib/feathers-http-auth.js';
import { unlessFeathersApiRoute } from './lib/unless-feathers-api-route.js';
import { DevProxy } from './services/dev-proxy.js';
import { CodeServerHandler } from './services/codeserver-handler.js';
import { DevserverHandler } from './services/devserver-handler.js';
import { LoopScheduler } from './services/loop-scheduler.js';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const expressApp = express();
const feathersApp = createFeathersApp();
registerAppErrorHandler(feathersApp);

feathersApp.set('db', db);

expressApp.set('view engine', 'ejs');
expressApp.set('views', path.join(__dirname, 'views'));

const server = createServer(expressApp);

const devProxy = new DevProxy(feathersApp, [CodeServerHandler, DevserverHandler]);
expressApp.set('devProxy', devProxy);

expressApp.get('/up', (req, res) => {
  res.send('OK');
});

expressApp.use(cookieParser(ENCRYPTION_KEY));

expressApp.use(devProxy.middleware);

// Slack signs the raw body, so keep it next to the parsed JSON for signature verification.
expressApp.use(
  '/api/slack',
  express.json({
    strict: false,
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
expressApp.use(unlessFeathersApiRoute(express.json({ strict: false })));
expressApp.use(unlessFeathersApiRoute(express.urlencoded({ extended: true })));
expressApp.use(cookieAuthMiddleware(feathersApp));

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
  if (feathersApp.get('handleAppError')?.(reason, {})) {
    logger.warn({ err: reason }, 'Handled unhandled rejection');
    return;
  }
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

const requireAuth = createRequireAuth();
const slackBot = createSlackBot(feathersApp);
feathersApp.set('slackBot', slackBot);
const slackSocket = createSlackSocketManager(feathersApp, slackBot);
expressApp.use(createMcpRoutes(feathersApp));
expressApp.use(createSlackRoutes(feathersApp, slackBot));
expressApp.use(createSettingsRoutes(requireAuth));
expressApp.use(createAuthRoutes(feathersApp));
expressApp.use(createImagesRoutes());

if (process.env.VITE_SERVER_ENABLED === 'true') {
  expressApp.get('/', (req, res) => {
    res.redirect(PUBLIC_HOST);
  });
}

if (process.env.VITE_SERVER_ENABLED !== 'true') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  expressApp.use(express.static(clientDist));
  expressApp.get('*', (req, res, next) => {
    if (req.url.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

expressApp.use((req, res, next) => {
  if (req.url.startsWith('/api/')) req.url = '/' + req.url.slice(5);
  next();
});

registerFeathersServices(feathersApp);

const feathersHttpHandler = createHandler(feathersApp, [
  errorHandler(),
  createFeathersCookieAuth(feathersApp),
  queryParser(),
  bodyParser(),
]);
expressApp.use(
  toAbortableNodeHandler(feathersHttpHandler, (req) => ({
    clientIp: req.feathers?.clientIp ?? getClientIp(req),
    user: req.feathers?.user,
  }))
);

feathersApp.hooks({
  error: {
    all: [
      async (context) => {
        const error = context.error;
        handleAppError(feathersApp, error, { userId: context.params?.user?.id });

        if (!error.code || error.code >= 500) {
          logger.error(error, 'Feathers error hook');
        }

        return context;
      },
    ],
  },
});

expressApp.use(createExpressErrorHandler(feathersApp));

const loopScheduler = new LoopScheduler(feathersApp);
feathersApp.set('loopScheduler', loopScheduler);
feathersApp.setup(server).then(
  async () => {
    slackBot.start();
    slackSocket.start();
    await feathersApp.service('sessions').restartInterruptedSessions();
    loopScheduler.start();
  },
  (err) => logger.error({ err }, 'App setup failed')
);

server.on('upgrade', (req, socket, head) => devProxy.handleUpgrade(req, socket, head));

const PORT = process.env.PORT || 3000;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
server.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST }, 'Server running');
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down');
  loopScheduler.stop();
  try {
    await feathersApp.service('tasks').killAllTasks();
  } catch (err) {
    logger.error({ err }, 'Error while stopping tasks');
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
