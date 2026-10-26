import logger from '../logger.js';
import { GitHubBadCredentialsError } from '../errors/github-errors.js';

const DEBOUNCE_MS = 60_000;
const lastNotifiedAt = new Map();

function notifyGitHubBadCredentials(app, userId) {
  if (!app || userId == null) return;
  const key = String(userId);
  const now = Date.now();
  const last = lastNotifiedAt.get(key);
  if (last != null && now - last < DEBOUNCE_MS) return;
  lastNotifiedAt.set(key, now);
  app.service('users').emit('github:bad-credentials', { user_id: userId });
}

/**
 * Handle known app-level errors (emit SSE events, etc.). Returns true when recognized.
 *
 * @param {{ service(name: string): any }} app
 * @param {unknown} err
 * @param {{ userId?: number, sessionId?: number }} [context]
 */
export function handleAppError(app, err, context = {}) {
  const error = normalizeError(err);
  if (error instanceof GitHubBadCredentialsError) {
    const userId = context.userId;
    if (userId != null) notifyGitHubBadCredentials(app, userId);
    return true;
  }
  return false;
}

function normalizeError(err) {
  if (err instanceof Error) return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return new Error(String(err.message));
  }
  return new Error(String(err));
}

/**
 * Attach handleAppError to a promise (agent turns and other fire-and-forget work).
 * Rejects with the original error after handling.
 *
 * @param {{ service(name: string): any }} app
 * @param {Promise<unknown>} promise
 * @param {{ userId?: number, sessionId?: number }} [context]
 */
export function attachAppErrorHandler(app, promise, context = {}) {
  return promise.catch((err) => {
    handleAppError(app, err, context);
    throw err;
  });
}

/** Register on the Feathers app for unhandledRejection and hooks. */
export function registerAppErrorHandler(app) {
  const handler = (err, context) => handleAppError(app, err, context);
  app.set('handleAppError', handler);
  return handler;
}

/** Forward async route failures to Express error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function httpStatus(err) {
  if (err.status >= 400 && err.status < 600) return err.status;
  if (err.statusCode >= 400 && err.statusCode < 600) return err.statusCode;
  if (typeof err.code === 'number' && err.code >= 400 && err.code < 600) return err.code;
  return 500;
}

function errorMessage(err) {
  if (err?.stderr) {
    const text = typeof err.stderr === 'string' ? err.stderr : err.stderr.toString();
    if (text.trim()) return text.trim();
  }
  return err?.message || 'Internal Server Error';
}

function isDevEnvironment() {
  return process.env.NODE_ENV === 'development';
}

/** @param {Record<string, unknown>} output */
export function enrichDevServerError(output, err) {
  const error = normalizeError(err);
  if (error.stack) output.stack = error.stack;
  const { cause } = error;
  if (cause !== undefined && cause !== null) {
    output.cause =
      cause instanceof Error
        ? { message: cause.message, ...(cause.stack ? { stack: cause.stack } : {}) }
        : cause;
  }
  return output;
}

export function devErrorPlainText(err) {
  const error = normalizeError(err);
  const lines = [error.message];
  const { cause } = error;
  if (cause !== undefined && cause !== null) {
    lines.push('', 'Caused by:');
    if (cause instanceof Error) {
      lines.push(cause.message);
      if (cause.stack) lines.push(cause.stack);
    } else {
      lines.push(String(cause));
    }
  }
  if (error.stack) {
    lines.push('', error.stack);
  }
  return lines.join('\n');
}

function devJsonErrorHandler(error, req, res) {
  const code = !Number.isNaN(Number.parseInt(error.code, 10))
    ? Number.parseInt(error.code, 10)
    : httpStatus(error);
  const output = error.toJSON
    ? { ...error.toJSON() }
    : { name: error.name || 'Error', message: error.message || 'Internal Server Error' };
  if (code >= 500) enrichDevServerError(output, error);
  res.status(code).set('Content-Type', 'application/json').json(output);
}

function devHtmlErrorHandler(error, req, res) {
  const code = !Number.isNaN(Number.parseInt(error.code, 10))
    ? Number.parseInt(error.code, 10)
    : 500;
  res.status(code).type('text/plain').send(devErrorPlainText(error));
}

function feathersJsonError(err, req, res) {
  const code = !Number.isNaN(Number.parseInt(err.code, 10))
    ? Number.parseInt(err.code, 10)
    : httpStatus(err);
  if (isDevEnvironment() && req.accepts('json')) {
    return devJsonErrorHandler(err, req, res);
  }
  const errorData = err.toJSON ? err.toJSON() : { message: errorMessage(err) };
  res.status(code).json(errorData);
}

/**
 * Express error middleware: handleAppError then Feathers-style JSON error formatting.
 */
export function createExpressErrorHandler(app) {
  const isDev = isDevEnvironment();
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    handleAppError(app, err, { userId: req.user?.id });
    const status = httpStatus(err);
    if (status >= 500) {
      logger.error({ err }, 'Express error handler');
    }
    if (err?.stderr) {
      err.message = errorMessage(err);
    }
    if (isDev && req.accepts('html') && !req.accepts('json')) {
      return devHtmlErrorHandler(err, req, res);
    }
    feathersJsonError(err, req, res);
  };
}
