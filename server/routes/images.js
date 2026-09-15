import { Router } from 'express';
import path from 'path';
import { IMAGES_DIR } from '../config.js';

// Serves uploaded images at /api/images/:imageId — no auth required so GitHub can
// load image URLs embedded in PR descriptions.
export default function createImagesRoutes() {
  const router = Router();

  router.get('/api/images/:imageId', (req, res) => {
    const { imageId } = req.params;
    if (!/^[\w-]{1,64}\.[a-z]{2,5}$/i.test(imageId)) {
      return res.status(400).json({ error: 'Invalid image ID' });
    }
    const filePath = path.join(IMAGES_DIR, imageId);
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Image not found' });
    });
  });

  return router;
}
