import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { sign } from 'cookie-signature';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';

const COOKIE_SECRET = 'test-cookie-secret';

const imagesDirCfg = vi.hoisted(() => ({ imagesDir: '' }));

vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  imagesDirCfg.imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bag-session-image-route-'));
  return {
    ...actual,
    IMAGES_DIR: imagesDirCfg.imagesDir,
  };
});

// The cookie middleware writes last-IP through the production db import — keep it
// pointed at the test db.
const dbMock = vi.hoisted(() => ({ current: null }));
function dbFacade(table) {
  return dbMock.current(table);
}
dbFacade.transaction = (...args) => dbMock.current.transaction(...args);
dbFacade.raw = (...args) => dbMock.current.raw(...args);
dbFacade.fn = { now: (...args) => dbMock.current.fn.now(...args) };
vi.mock('../../db.js', () => ({ default: dbFacade }));

import createSessionImageRoutes from '../session-images.js';
import { createRequireAuth } from '../../middleware/auth.js';
import { cookieAuthMiddleware } from '../../feathers.js';

const db = createTestDb();
const imagesDir = () => imagesDirCfg.imagesDir;

describe('session-images file route', () => {
  let server;
  let baseUrl;
  let ownerSession;
  let sharedImageId;
  let ownImageId;

  const signedUserCookie = (userId) => `userId=s%3A${sign(String(userId), COOKIE_SECRET)}`;

  function fakeFeathersApp() {
    return {
      get: (key) => (key === 'db' ? db : undefined),
      service: (name) => {
        if (name !== 'users') throw new Error(`unexpected service: ${name}`);
        return {
          async get(id) {
            const user = await db('users')
              .where({ id: Number(id) })
              .first();
            if (!user) throw Object.assign(new Error('Not found'), { name: 'NotFound' });
            return user;
          },
        };
      },
    };
  }

  async function seedImage({ sessionId, slug }) {
    const [id] = await db('session_images').insert({
      session_id: sessionId,
      image_slug: slug,
      file_ext: '.png',
      media_type: 'image/png',
      alt_text: 'a screenshot',
      github_url: null,
      created_at: new Date().toISOString(),
    });
    return id;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    dbMock.current = db;
    await db('users').insert({ github_id: 1, username: 'owner', status: 'approved' });
    await db('users').insert({ github_id: 2, username: 'viewer', status: 'approved' });
    await db('users').insert({ github_id: 3, username: 'outsider', status: 'approved' });
    const owner = await db('users').where({ username: 'owner' }).first();

    const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
    const [sharedRepoId] = await db('repos').insert({ full_name: 'p/q', repo_path: '/tmp/q' });
    ownerSession = await insertTestSession(db, {
      user_id: owner.id,
      repo_id: repoId,
      repo_full_name: 'o/r',
      base_branch: 'main',
      initial_prompt: 'own',
      short_id: 'ownimgs',
      status: 'stopped',
      is_shared: 0,
    });
    const sharedSession = await insertTestSession(db, {
      user_id: owner.id,
      repo_id: sharedRepoId,
      repo_full_name: 'p/q',
      base_branch: 'main',
      initial_prompt: 'shared',
      short_id: 'shimgs',
      status: 'stopped',
      is_shared: 1,
    });

    ownImageId = await seedImage({ sessionId: ownerSession, slug: 'own-image-slug' });
    fs.writeFileSync(path.join(imagesDir(), 'own-image-slug.png'), 'own-bytes');
    sharedImageId = await seedImage({ sessionId: sharedSession, slug: 'shared-image-slug' });
    fs.writeFileSync(path.join(imagesDir(), 'shared-image-slug.png'), 'shared-bytes');

    const app = express();
    app.use(express.json());
    app.use(cookieParser(COOKIE_SECRET));
    app.use(cookieAuthMiddleware(fakeFeathersApp()));
    app.use(createSessionImageRoutes(fakeFeathersApp(), createRequireAuth()));
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    fs.rmSync(imagesDirCfg.imagesDir, { recursive: true, force: true });
  });

  async function request(path, { cookie } = {}) {
    const res = await fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
    const text = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get('content-type'),
      cacheControl: res.headers.get('cache-control'),
      text,
    };
  }

  it('requires authentication', async () => {
    const res = await request(`/api/session-images/${ownImageId}/file`);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text).error).toMatch(/Not authenticated/);
  });

  it('serves the owner their image bytes with the stored media type', async () => {
    const res = await request(`/api/session-images/${ownImageId}/file`, {
      cookie: signedUserCookie(1),
    });
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('image/png');
    expect(res.cacheControl).toContain('private');
    expect(res.text).toBe('own-bytes');
  });

  it('serves images of shared sessions to other signed-in users', async () => {
    const viewer = await db('users').where({ username: 'viewer' }).first();
    const res = await request(`/api/session-images/${sharedImageId}/file`, {
      cookie: signedUserCookie(viewer.id),
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('shared-bytes');
  });

  it('hides images of other users unshared sessions', async () => {
    const viewer = await db('users').where({ username: 'viewer' }).first();
    const res = await request(`/api/session-images/${ownImageId}/file`, {
      cookie: signedUserCookie(viewer.id),
    });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text).error).toMatch(/Image not found/);
  });

  it('404s unknown, non-numeric, and on-disk-missing images', async () => {
    const cookie = signedUserCookie(1);
    expect((await request('/api/session-images/99999/file', { cookie })).status).toBe(404);
    expect((await request('/api/session-images/not-an-id/file', { cookie })).status).toBe(404);

    await db('session_images').insert({
      session_id: ownerSession,
      image_slug: 'missing-on-disk',
      file_ext: '.webp',
      media_type: 'image/webp',
      alt_text: 'gone',
      github_url: null,
      created_at: new Date().toISOString(),
    });
    const missingRow = await db('session_images').where({ image_slug: 'missing-on-disk' }).first();
    expect((await request(`/api/session-images/${missingRow.id}/file`, { cookie })).status).toBe(
      404
    );
  });
});
