import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { GitHubBadCredentialsError } from '../../errors/github-errors.js';
import {
  createExpressErrorHandler,
  devErrorPlainText,
  enrichDevServerError,
  handleAppError,
} from '../../lib/app-error-handler.js';

describe('handleAppError', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits github:bad-credentials for GitHubBadCredentialsError with userId', () => {
    const emit = vi.fn();
    const app = { service: () => ({ emit }) };

    const handled = handleAppError(app, new GitHubBadCredentialsError(), { userId: 3 });

    expect(handled).toBe(true);
    expect(emit).toHaveBeenCalledWith('github:bad-credentials', { user_id: 3 });
  });

  it('debounces duplicate notifications', () => {
    const emit = vi.fn();
    const app = { service: () => ({ emit }) };
    const err = new GitHubBadCredentialsError();

    handleAppError(app, err, { userId: 7 });
    handleAppError(app, err, { userId: 7 });

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('returns false for unknown errors', () => {
    const app = { service: () => ({ emit: vi.fn() }) };
    expect(handleAppError(app, new Error('nope'), { userId: 1 })).toBe(false);
  });
});

describe('enrichDevServerError', () => {
  it('adds stack and cause for server errors', () => {
    const cause = new Error('missing column');
    const err = new Error('Dev sign-in failed');
    err.cause = cause;
    err.stack = 'Error: Dev sign-in failed\n    at auth.js:1:1';

    const output = enrichDevServerError({ message: err.message }, err);

    expect(output.stack).toBe(err.stack);
    expect(output.cause).toEqual({ message: 'missing column', stack: cause.stack });
  });
});

describe('devErrorPlainText', () => {
  it('includes message, cause, and stack', () => {
    const cause = new Error('SQLITE_ERROR: no such column');
    const err = new Error('select failed');
    err.cause = cause;
    err.stack = 'Error: select failed\n    at Object.<anonymous>';

    const text = devErrorPlainText(err);

    expect(text).toContain('select failed');
    expect(text).toContain('Caused by:');
    expect(text).toContain('SQLITE_ERROR: no such column');
    expect(text).toContain('at Object.<anonymous>');
  });
});

describe('createExpressErrorHandler (development)', () => {
  const prevNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
  });

  it('returns JSON with stack for 500 API errors', async () => {
    const app = express();
    app.get('/fail', () => {
      const err = new Error('no such column: users.foo');
      err.stack = 'Error: no such column\n    at query.js:10:5';
      throw err;
    });
    app.use(createExpressErrorHandler({ service: () => ({}) }));

    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/fail`, {
      headers: { Accept: 'application/json' },
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.message).toBe('no such column: users.foo');
    expect(body.stack).toContain('query.js:10:5');

    await new Promise((resolve) => server.close(resolve));
  });

  it('returns plain text with stack for browser-style requests', async () => {
    const app = express();
    app.get('/fail', () => {
      throw new Error('Dev sign-in failed');
    });
    app.use(createExpressErrorHandler({ service: () => ({}) }));

    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/fail`, {
      headers: { Accept: 'text/html' },
    });
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).toContain('Dev sign-in failed');
    expect(text).toContain('Error: Dev sign-in failed');

    await new Promise((resolve) => server.close(resolve));
  });
});
