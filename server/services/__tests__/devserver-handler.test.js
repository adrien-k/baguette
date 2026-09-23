import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevserverHandler } from '../devserver-handler.js';

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
