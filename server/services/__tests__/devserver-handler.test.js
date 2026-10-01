import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevserverHandler } from '../devserver-handler.js';
import { DEFAULT_TTL_MS } from '../task.js';

describe('DevserverHandler.allowUser', () => {
  const res = { status: vi.fn().mockReturnThis(), render: vi.fn() };

  function handlerForSession(session) {
    const app = {
      get: () => () => ({
        where: () => ({
          first: () => Promise.resolve(session),
        }),
      }),
    };
    const h = new DevserverHandler(app, { headers: { host: 'session-abc.example.com' } });
    h.shortId = session.short_id;
    return h;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the session owner', async () => {
    const session = {
      user_id: 1,
      short_id: 'abc',
      worktree_path: '/wt',
      is_preview_users_public: false,
    };
    const h = handlerForSession(session);
    vi.spyOn(h, '_hasPreviewConfig').mockResolvedValue(true);
    await expect(h.allowUser(1, res)).resolves.toBe(true);
  });

  it('allows any signed-in user when is_preview_users_public is true', async () => {
    const session = {
      user_id: 1,
      short_id: 'abc',
      worktree_path: '/wt',
      is_preview_users_public: true,
      is_preview_public: false,
    };
    const h = handlerForSession(session);
    vi.spyOn(h, '_hasPreviewConfig').mockResolvedValue(true);
    await expect(h.allowUser(99, res)).resolves.toBe(true);
  });

  it('allows any signed-in user when is_preview_users_public is unset (default)', async () => {
    const session = { user_id: 1, short_id: 'abc', worktree_path: '/wt', is_preview_public: false };
    const h = handlerForSession(session);
    vi.spyOn(h, '_hasPreviewConfig').mockResolvedValue(true);
    await expect(h.allowUser(99, res)).resolves.toBe(true);
  });

  it('returns 404 when the session row is missing', async () => {
    const app = {
      get: () => () => ({
        where: () => ({
          first: () => Promise.resolve(null),
        }),
      }),
    };
    const h = new DevserverHandler(app, { headers: { host: 'session-missing.example.com' } });
    h.shortId = 'missing';
    await expect(h.allowUser(1, res)).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith(
      'devserver-denied',
      expect.objectContaining({ message: 'This session does not exist or was archived.' })
    );
  });

  it('returns 404 for archived sessions even when preview is public', async () => {
    const session = {
      user_id: 1,
      short_id: 'abc',
      worktree_path: '/wt',
      is_preview_public: true,
      archived_at: '2026-01-01T00:00:00.000Z',
    };
    const h = handlerForSession(session);
    await expect(h.allowUser(null, res)).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith(
      'devserver-denied',
      expect.objectContaining({ message: 'This session does not exist or was archived.' })
    );
  });

  it('denies other users when is_preview_users_public is false', async () => {
    const session = {
      user_id: 1,
      short_id: 'abc',
      worktree_path: '/wt',
      is_preview_users_public: false,
      is_preview_public: false,
    };
    const h = handlerForSession(session);
    vi.spyOn(h, '_hasPreviewConfig').mockResolvedValue(true);
    await expect(h.allowUser(99, res)).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('DevserverHandler.render', () => {
  it('redirects the portal host to the lone service subdomain', async () => {
    process.env.PUBLIC_API_URL = 'https://app.example.com';
    const session = { id: 1, user_id: 1, short_id: 'abc', worktree_path: '/wt' };
    const app = {
      get: () => () => ({
        where: () => ({ first: () => Promise.resolve(session) }),
      }),
    };
    const res = { redirect: vi.fn() };
    const handler = new DevserverHandler(app, { headers: { host: 'session-abc.app.example.com' } });
    handler.shortId = 'abc';
    handler.serviceName = null;
    vi.spyOn(handler, '_getConfig').mockResolvedValue({
      services: { app: { task: 'dev', expose: 'PORT' } },
      session: { tasks: { dev: { run: 'vite', ports: ['PORT'] } } },
    });

    const handled = await handler.render(res);

    expect(handled).toBe(true);
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('session-abc-app.'));
  });
});

describe('DevserverHandler.buildTask', () => {
  it('passes ttl_ms for dev-proxy auto-start on preview link', async () => {
    const create = vi.fn(async (data) => ({ id: 99, ...data }));
    const session = { id: 5, user_id: 2, short_id: 'abc', worktree_path: '/wt' };
    const app = {
      get: () => () => ({
        where: () => ({ first: () => Promise.resolve(session) }),
      }),
      service: () => ({
        create,
        getTask: () => ({ id: 99, status: 'running' }),
      }),
    };
    const handler = new DevserverHandler(app, { headers: { host: 'session-abc.example.com' } });
    handler.shortId = 'abc';
    vi.spyOn(handler, '_getConfig').mockResolvedValue({
      services: { app: { task: 'dev', expose: 'PORT' } },
      session: { tasks: { dev: { run: 'npm start', ports: ['PORT'] } } },
    });

    await handler.buildTask();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 5,
        task_key: 'dev',
        autoStart: false,
        ttl_ms: DEFAULT_TTL_MS,
      }),
      { user: { id: 2 } }
    );
  });
});
