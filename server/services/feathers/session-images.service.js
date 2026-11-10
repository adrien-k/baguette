import { KnexService } from '@feathersjs/knex';
import { BadRequest } from 'feathers/errors';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { requireUser, scopeBySessionUser, only, disableExternal } from './hooks.js';
import { requireOwnSessionForWrite } from './shared-access.js';
import { DEFAULT_PAGINATE, IMAGES_DIR } from '../../config.js';
import {
  SESSION_IMAGE_MEDIA_TYPES,
  MAX_SESSION_IMAGE_BYTES,
  findSessionImagePlaceholders,
  sessionImageFileName,
} from '../../../shared/session-images.js';
import { uploadImageAsset } from '../../lib/image-asset-upload.js';

function normalizeAltText(raw) {
  return (
    String(raw ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500) || 'screenshot'
  );
}

class SessionImagesService extends KnexService {
  setup(app) {
    this.app = app;
  }

  /**
   * Stores an uploaded image: copies the bytes into IMAGES_DIR under a new
   * unique slug and records the row (`github_url` stays null until the image
   * is attached to the session PR during a push).
   */
  async create(data, params) {
    const fileExt = SESSION_IMAGE_MEDIA_TYPES[data.media_type];
    if (!fileExt) {
      throw new BadRequest('Unsupported media type');
    }
    const bytes = data.bytes;
    if (!Buffer.isBuffer(bytes)) throw new BadRequest('Image bytes are required');
    if (bytes.length === 0) throw new BadRequest('Image is empty');
    if (bytes.length > MAX_SESSION_IMAGE_BYTES) {
      throw new BadRequest(
        `Image is too large (${(bytes.length / 1024 / 1024).toFixed(1)} MB, max 16 MB)`
      );
    }
    if (data.session_id == null) throw new BadRequest('session_id is required');

    const imageSlug = randomUUID();
    const fileName = sessionImageFileName(imageSlug, fileExt);
    const absolutePath = path.join(IMAGES_DIR, fileName);
    await fs.promises.writeFile(absolutePath, bytes);
    try {
      return await super.create(
        {
          session_id: data.session_id,
          image_slug: imageSlug,
          file_ext: fileExt,
          media_type: data.media_type,
          alt_text: normalizeAltText(data.alt_text),
          github_url: null,
          created_at: new Date().toISOString(),
        },
        params
      );
    } catch (err) {
      await fs.promises.rm(absolutePath, { force: true }).catch(() => {});
      throw err;
    }
  }

  /**
   * Push-time resolution for the images a PR body references through
   * `{{image:<slug>}}` placeholders. Attaches images that are not anchored in
   * the PR yet (never uploaded there, or dropped from the body since), caches
   * the resulting GitHub URLs on their rows, and reports a slug → url map for
   * body interpolation — plus every failure that left a placeholder behind.
   * Internal only: called by the sessions service while syncing the PR body.
   */
  async resolveForPush(data) {
    const { session, bodyWithPlaceholders, existingPrBody = '' } = data;
    const internal = { user: { id: session.user_id }, provider: undefined };
    const rows = await this.find({
      query: { session_id: session.id, $limit: 500 },
      paginate: false,
      user: internal.user,
    });

    const resolved = {};
    const failures = [];
    for (const row of rows) {
      if (!bodyWithPlaceholders.includes(`{{image:${row.image_slug}}}`)) continue;
      if (row.github_url && existingPrBody.includes(row.github_url)) {
        resolved[row.image_slug] = { url: row.github_url, alt_text: row.alt_text };
        continue;
      }
      try {
        const { url } = await uploadImageAsset({
          repoFullName: session.repo_full_name,
          token: data.token,
          imageFilePath: path.join(IMAGES_DIR, sessionImageFileName(row.image_slug, row.file_ext)),
          mediaType: row.media_type,
        });
        await super.patch(row.id, { github_url: url }, internal);
        resolved[row.image_slug] = { url, alt_text: row.alt_text };
      } catch (err) {
        failures.push({ image_slug: row.image_slug, message: err?.message ?? String(err) });
      }
    }
    const referenced = findSessionImagePlaceholders(bodyWithPlaceholders);
    const missing = referenced.filter(
      (imageSlug) => !rows.some((row) => row.image_slug === imageSlug) && !resolved[imageSlug]
    );
    for (const imageSlug of missing) {
      failures.push({
        image_slug: imageSlug,
        message: 'no session image with this id was uploaded',
      });
    }
    return { resolved, failures };
  }
}

export function registerSessionImagesService(app, path = 'session-images') {
  const options = {
    Model: app.get('db'),
    name: 'session_images',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new SessionImagesService(options), {
    methods: ['find', 'get', 'create', 'remove', 'resolveForPush'],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeBySessionUser],
      create: [requireOwnSessionForWrite, only(['session_id', 'media_type', 'bytes', 'alt_text'])],
      remove: [requireOwnSessionForWrite],
      resolveForPush: [disableExternal],
    },
  });
}
