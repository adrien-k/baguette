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

const s3Mocks = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    constructor() {
      this.send = s3Mocks.send;
    }
  }
  class PutObjectCommand {
    constructor(input) {
      Object.assign(this, input);
    }
  }
  class DeleteObjectCommand {
    constructor(input) {
      Object.assign(this, input);
    }
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand };
});

import { uploadImageAsset as uploadImageAssetModule } from '../../lib/image-asset-upload.js';
import { encrypt } from '../../lib/encrypt.js';
import { invalidatePublicStorageCache } from '../../lib/public-storage-config.js';
import { groomSessionImages } from '../feathers/session-images.service.js';

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

async function seedPublicStorage() {
  await db('instance_settings')
    .where({ id: 1 })
    .update({
      public_storage_endpoint_url: 'https://s3.example.com',
      public_storage_bucket: 'pub',
      public_storage_region: 'us-east-1',
      public_storage_access_key_id: 'AKIA',
      public_storage_secret_access_key_encrypted: encrypt('secret'),
      public_storage_public_base_url: 'https://cdn.example.com',
    });
  invalidatePublicStorageCache();
}

beforeEach(async () => {
  uploadImageAssetMock.mockReset();
  s3Mocks.send.mockReset();
  s3Mocks.send.mockResolvedValue({});
  invalidatePublicStorageCache();
  await db('instance_settings').where({ id: 1 }).update({
    public_storage_endpoint_url: null,
    public_storage_bucket: null,
    public_storage_region: null,
    public_storage_access_key_id: null,
    public_storage_secret_access_key_encrypted: null,
    public_storage_public_base_url: null,
  });
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

describe('session-images resolveForPush with public storage', () => {
  function seedRow({
    image_slug,
    public_url = null,
    object_key = null,
    alt_text = 'shot',
    file_ext = '.png',
  }) {
    return db('session_images').insert({
      session_id: sessionId,
      image_slug,
      file_ext,
      media_type: `image/${file_ext.slice(1)}`,
      alt_text,
      github_url: null,
      public_url,
      object_key,
      created_at: new Date().toISOString(),
    });
  }

  function callResolve({ body, existing = '' }) {
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
        attachImages: true,
      },
      { user: { id: user.id }, provider: undefined }
    );
  }

  beforeEach(async () => {
    await seedPublicStorage();
  });

  it('uploads under an unguessable key and skips GitHub attach', async () => {
    await seedRow({ image_slug: 'img-s3' });
    fs.writeFileSync(path.join(imagesDir(), 'img-s3.png'), 'png-bytes');

    const { resolved, failures } = await callResolve({ body: '{{image:img-s3}}' });

    expect(failures).toEqual([]);
    expect(uploadImageAssetMock).not.toHaveBeenCalled();

    const row = await db('session_images').where({ image_slug: 'img-s3' }).first();
    expect(row.object_key).toMatch(/^baguette\/[A-Za-z0-9_-]{43}\.png$/);
    expect(row.object_key).not.toContain(`/sessions/${sessionId}/`);
    expect(row.object_key).not.toContain('img-s3');
    const url = `https://cdn.example.com/${row.object_key}`;
    expect(row.public_url).toBe(url);
    expect(resolved['img-s3']).toEqual({ url, alt_text: 'shot' });
    expect(s3Mocks.send.mock.calls[0][0].Key).toBe(row.object_key);
  });

  it('reuses a public URL only when its object key is the stored secret', async () => {
    const objectKey = `baguette/${'a'.repeat(43)}.png`;
    const url = `https://cdn.example.com/${objectKey}`;
    await seedRow({ image_slug: 'img-reuse', public_url: url, object_key: objectKey });
    fs.writeFileSync(path.join(imagesDir(), 'img-reuse.png'), 'png');

    const { resolved } = await callResolve({
      body: '{{image:img-reuse}}',
      existing: `![shot](${url})`,
    });

    expect(resolved['img-reuse'].url).toBe(url);
    expect(s3Mocks.send).not.toHaveBeenCalled();
    expect(uploadImageAssetMock).not.toHaveBeenCalled();
  });

  it('replaces a public URL that embeds the image slug', async () => {
    const guessable = `https://cdn.example.com/baguette/sessions/${sessionId}/img-slug.png`;
    await seedRow({ image_slug: 'img-slug', public_url: guessable });
    fs.writeFileSync(path.join(imagesDir(), 'img-slug.png'), 'png');

    const { resolved } = await callResolve({
      body: '{{image:img-slug}}',
      existing: `![shot](${guessable})`,
    });

    const row = await db('session_images').where({ image_slug: 'img-slug' }).first();
    expect(resolved['img-slug'].url).toBe(`https://cdn.example.com/${row.object_key}`);
    expect(row.object_key).not.toContain('img-slug');
    expect(row.public_url).not.toBe(guessable);
    const keys = s3Mocks.send.mock.calls.map((call) => call[0].Key);
    expect(keys).toContain(row.object_key);
    expect(keys).toContain(`baguette/sessions/${sessionId}/img-slug.png`);
  });
});

describe('groomSessionImages', () => {
  it('keeps referenced and fresh unreferenced images, deletes stale unreferenced', async () => {
    await seedPublicStorage();
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const freshAt = new Date().toISOString();
    const objectKey = `baguette/${'b'.repeat(43)}.png`;
    const publicUrl = `https://cdn.example.com/${objectKey}`;

    await db('session_images').insert([
      {
        session_id: sessionId,
        image_slug: 'kept-ref',
        file_ext: '.png',
        media_type: 'image/png',
        alt_text: 'ref',
        github_url: null,
        public_url: null,
        created_at: staleAt,
      },
      {
        session_id: sessionId,
        image_slug: 'kept-fresh',
        file_ext: '.png',
        media_type: 'image/png',
        alt_text: 'fresh',
        github_url: null,
        public_url: null,
        created_at: freshAt,
      },
      {
        session_id: sessionId,
        image_slug: 'stale',
        file_ext: '.png',
        media_type: 'image/png',
        alt_text: 'old',
        github_url: null,
        public_url: publicUrl,
        object_key: objectKey,
        created_at: staleAt,
      },
    ]);
    fs.writeFileSync(path.join(imagesDir(), 'stale.png'), 'x');
    await db('sessions')
      .where({ id: sessionId })
      .update({ pr_description: 'Uses {{image:kept-ref}} only' });

    const deleted = await groomSessionImages(app, sessionId);
    expect(deleted).toBe(1);
    expect(s3Mocks.send.mock.calls.some((call) => call[0].Key === objectKey)).toBe(true);
    expect(await db('session_images').where({ image_slug: 'stale' }).first()).toBeUndefined();
    expect(await db('session_images').where({ image_slug: 'kept-ref' }).first()).toBeTruthy();
    expect(await db('session_images').where({ image_slug: 'kept-fresh' }).first()).toBeTruthy();
    expect(fs.existsSync(path.join(imagesDir(), 'stale.png'))).toBe(false);
  });
});
