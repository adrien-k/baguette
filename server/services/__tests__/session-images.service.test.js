import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { feathers } from 'feathers';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PUBLIC_HOST } from '../../config.js';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerSessionImagesService } from '../feathers/session-images.service.js';

const cfg = vi.hoisted(() => ({ imagesDir: '' }));

vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  cfg.imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bag-session-images-'));
  return {
    ...actual,
    IMAGES_DIR: cfg.imagesDir,
  };
});

vi.mock('../../lib/image-asset-upload.js', () => ({
  uploadImageAsset: vi.fn(),
}));

import { uploadImageAsset as uploadImageAssetModule } from '../../lib/image-asset-upload.js';

const uploadImageAssetMock = /** @type {import('vitest').Mock} */ (uploadImageAssetModule);

const db = createTestDb();

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  registerSessionImagesService(app);
  return app;
}

const imagesDir = () => cfg.imagesDir;
let app;
let user;
let sessionId;

afterAll(() => {
  fs.rmSync(cfg.imagesDir, { recursive: true, force: true });
});

beforeEach(async () => {
  uploadImageAssetMock.mockReset();
  await db('session_images').del();
  await db('users').insert({ github_id: 1, username: 'alice', status: 'approved' });
  user = await db('users').where({ username: 'alice' }).first();
  const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  sessionId = await insertTestSession(db, {
    user_id: user.id,
    repo_id: repoId,
    repo_full_name: 'o/r',
    base_branch: 'main',
    initial_prompt: 't',
    short_id: 'imgs',
    status: 'stopped',
    session_path: '/tmp/wt',
  });
  app = makeApp(db);
  await app.setup();
});

async function createImage(overrides = {}) {
  const params = { provider: 'rest', user };
  return app.service('session-images').create(
    {
      session_id: sessionId,
      media_type: 'image/png',
      bytes: Buffer.from('png-bytes'),
      alt_text: 'a screenshot',
      ...overrides,
    },
    params
  );
}

describe('session-images service create', () => {
  it('stores the file under a unique slug and records the row', async () => {
    const row = await createImage({ alt_text: '  before\n\nafter  ' });

    expect(row.session_id).toBe(sessionId);
    expect(row.image_slug).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.file_ext).toBe('.png');
    expect(row.media_type).toBe('image/png');
    expect(row.alt_text).toBe('before after');
    expect(row.github_url).toBeNull();

    const stored = fs.readFileSync(path.join(imagesDir(), `${row.image_slug}.png`));
    expect(stored.toString()).toBe('png-bytes');
    const dbRow = await db('session_images').where({ id: row.id }).first();
    expect(dbRow.created_at).toBeTruthy();
  });

  it('falls back to the filename for missing alt text', async () => {
    const row = await createImage({ alt_text: '' });
    expect(row.alt_text).toBe('screenshot');
  });

  it('rejects unsupported media types', async () => {
    await expect(createImage({ media_type: 'image/svg+xml' })).rejects.toThrow(
      /Unsupported media type/
    );
  });

  it('requires non-empty bytes within the size cap', async () => {
    await expect(createImage({ bytes: Buffer.alloc(0) })).rejects.toThrow(/empty/i);
    const oversized = Buffer.alloc(16 * 1024 * 1024 + 1);
    await expect(createImage({ bytes: oversized })).rejects.toThrow(/too large/);
  });

  it('requires a session', async () => {
    await expect(createImage({ session_id: null })).rejects.toThrow(/session_id/);
  });
});

describe('session-images resolveForPush', () => {
  function seedRow({ image_slug, github_url = null, alt_text = 'shot', file_ext = '.png' }) {
    return db('session_images').insert({
      session_id: sessionId,
      image_slug,
      file_ext,
      media_type: `image/${file_ext.slice(1)}`,
      alt_text,
      github_url,
      created_at: new Date().toISOString(),
    });
  }

  function callResolveForPush({ body, existing = '', attach = true }) {
    return app.service('session-images').resolveForPush(
      {
        session: {
          id: sessionId,
          user_id: user.id,
          repo_full_name: 'o/r',
          pr_number: 12,
        },
        token: 'tok',
        bodyWithPlaceholders: body,
        existingPrBody: existing,
        attachImages: attach,
      },
      { user: { id: user.id }, provider: undefined }
    );
  }

  it('resolves cached anchors, attaches fresh images, and reports failures', async () => {
    const urlA = 'https://github.com/user-attachments/assets/AAA';
    await seedRow({ image_slug: 'img-a', github_url: urlA });
    await seedRow({ image_slug: 'img-b' });
    await seedRow({
      image_slug: 'img-c',
      github_url: 'https://github.com/user-attachments/assets/CCC',
    });

    const existing = '![a](https://github.com/user-attachments/assets/AAA)\n\nsomething else\n';
    const body = `top\n\n{{image:img-a}}\n{{image:img-b}}\n{{image:img-c}}\n{{image:ghost}}`;

    uploadImageAssetMock
      .mockResolvedValueOnce({ url: 'https://github.com/user-attachments/assets/BBB' })
      .mockRejectedValueOnce(new Error('gh could not upload c.png: HTTP 403'));

    const { resolved, failures } = await callResolveForPush({ body, existing });

    expect(resolved['img-a']).toEqual({ url: urlA, alt_text: 'shot' });
    expect(resolved['img-b']).toEqual({
      url: 'https://github.com/user-attachments/assets/BBB',
      alt_text: 'shot',
    });
    expect(resolved['img-c']).toBeUndefined();
    expect(resolved['ghost']).toBeUndefined();

    expect(failures).toEqual([
      { image_slug: 'img-c', message: expect.stringMatching(/gh could not upload c\.png/) },
      { image_slug: 'ghost', message: expect.stringMatching(/no session image/) },
    ]);

    expect(uploadImageAssetMock).toHaveBeenCalledTimes(2);
    expect(uploadImageAssetMock.mock.calls[0][0]).toMatchObject({
      repoFullName: 'o/r',
      token: 'tok',
      imageFilePath: expect.stringMatching(/img-b\.png$/),
      mediaType: 'image/png',
    });

    const b = await db('session_images').where({ image_slug: 'img-b' }).first();
    expect(b.github_url).toBe('https://github.com/user-attachments/assets/BBB');
    const c = await db('session_images').where({ image_slug: 'img-c' }).first();
    expect(c.github_url).toBe('https://github.com/user-attachments/assets/CCC');
  });

  it('skips images the body does not reference', async () => {
    await seedRow({ image_slug: 'img-unused' });
    const { resolved, failures } = await callResolveForPush({ body: 'no images here' });
    expect(resolved).toEqual({});
    expect(failures).toEqual([]);
    expect(uploadImageAssetMock).not.toHaveBeenCalled();
  });

  it('re-attaches when the cached URL no longer appears upstream', async () => {
    const urlA = 'https://github.com/user-attachments/assets/AAA';
    await seedRow({ image_slug: 'img-a', github_url: urlA });
    uploadImageAssetMock.mockResolvedValueOnce({
      url: 'https://github.com/user-attachments/assets/ZZZ',
    });

    const { resolved } = await callResolveForPush({
      body: 'see {{image:img-a}}',
      existing: 'body without that image',
    });

    expect(resolved['img-a'].url).toBe('https://github.com/user-attachments/assets/ZZZ');
    const row = await db('session_images').where({ image_slug: 'img-a' }).first();
    expect(row.github_url).toBe('https://github.com/user-attachments/assets/ZZZ');
  });

  it('publishes public image URLs without touching GitHub when attach is disabled', async () => {
    await seedRow({
      image_slug: 'img-a',
      github_url: 'https://github.com/user-attachments/assets/AAA',
    });
    await seedRow({ image_slug: 'img-b' });

    const { resolved, failures } = await callResolveForPush({
      body: 'top\n\n{{image:img-a}}\n{{image:img-b}}\n{{image:ghost}}',
      attach: false,
    });

    expect(resolved['img-a']).toEqual({
      // publicSessionImageUrl strips a trailing slash from the configured origin.
      url: `${PUBLIC_HOST.replace(/\/$/, '')}/api/images/img-a.png`,
      alt_text: 'shot',
    });
    expect(resolved['img-b']).toEqual({
      url: expect.stringMatching(/^https?:\/\//),
      alt_text: 'shot',
    });
    expect(resolved['img-b'].url).toContain('/api/images/img-b.png');
    expect(failures).toEqual([
      { image_slug: 'ghost', message: expect.stringMatching(/no session image/) },
    ]);
    expect(uploadImageAssetMock).not.toHaveBeenCalled();
    const a = await db('session_images').where({ image_slug: 'img-a' }).first();
    expect(a.github_url).toBe('https://github.com/user-attachments/assets/AAA');
    const b = await db('session_images').where({ image_slug: 'img-b' }).first();
    expect(b.github_url).toBeNull();
  });
});
