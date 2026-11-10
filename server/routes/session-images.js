import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '../lib/app-error-handler.js';
import { IMAGES_DIR } from '../config.js';
import { sessionImageFileName } from '../../shared/session-images.js';

/**
 * Serves stored session images to signed-in viewers. Authenticated and
 * session-scoped: the Details tab renders from this route, while GitHub
 * embeds use `user-attachments` asset URLs from the PR body.
 */
export default function createSessionImageRoutes(feathersApp, requireAuth) {
  const router = Router();
  const db = feathersApp.get('db');

  router.get(
    '/api/session-images/:imageId/file',
    requireAuth,
    asyncHandler(async (req, res) => {
      const dbRow = Number(req.params.imageId);
      const row =
        Number.isInteger(dbRow) && dbRow > 0
          ? await db('session_images').where({ id: dbRow }).first()
          : null;
      const session = row ? await db('sessions').where({ id: row.session_id }).first() : null;
      // Same visibility the session-images Feathers service grants: the owner,
      // and any signed-in viewer when the session is shared.
      const viewer = req.user;
      const canView =
        row && session && viewer && (session.user_id === viewer.id || !!session.is_shared);
      if (!canView) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const filePath = path.join(IMAGES_DIR, sessionImageFileName(row.image_slug, row.file_ext));
      res.set('Content-Type', row.media_type);
      res.set('Cache-Control', 'private, max-age=60');

      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).json({ error: 'Image not found' });
      });
      stream.pipe(res);
    })
  );

  return router;
}
