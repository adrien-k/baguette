import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { IMAGES_DIR, PUBLIC_API_HOST } from '../../../config.js';
import { ok, fail } from '../lib/result.js';

export function createUploadImageTool(ctx) {
  const { absoluteWorktreePath } = ctx;
  return {
    name: 'UploadImage',
    description:
      'Upload an image so it can be embedded in the PR description or comments via a public URL. ' +
      'Provide either filePath (a path relative to the worktree root, e.g. a screenshot saved by a test or Playwright) ' +
      'or base64 + mediaType for raw image data. ' +
      'Returns a public URL and a ready-to-use markdown snippet like ![alt](url).',
    schema: {
      filePath: z
        .string()
        .optional()
        .describe('Path to the image file, relative to the worktree root'),
      base64: z
        .string()
        .optional()
        .describe('Base64-encoded image data (required when filePath is omitted)'),
      mediaType: z
        .enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
        .optional()
        .describe('MIME type of the image (required when using base64)'),
      altText: z.string().optional().describe('Alt text for the markdown image snippet'),
    },
    handler: async ({ filePath, base64, mediaType, altText = 'screenshot' }) => {
      const MEDIA_TYPE_EXT = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
      };
      const EXT_MEDIA_TYPE = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };

      let imageBuffer;
      let ext;

      if (filePath) {
        const absPath = path.resolve(absoluteWorktreePath, filePath);
        if (
          !absPath.startsWith(absoluteWorktreePath + path.sep) &&
          absPath !== absoluteWorktreePath
        ) {
          return fail('filePath must be within the worktree');
        }
        const fileExt = path.extname(filePath).toLowerCase();
        if (!EXT_MEDIA_TYPE[fileExt]) {
          return fail(
            `Unsupported image extension: ${fileExt}. Supported: .png .jpg .jpeg .gif .webp`
          );
        }
        try {
          imageBuffer = await fs.promises.readFile(absPath);
        } catch {
          return fail(`Could not read file: ${filePath}`);
        }
        ext = fileExt;
      } else if (base64 && mediaType) {
        if (!MEDIA_TYPE_EXT[mediaType]) {
          return fail(`Unsupported mediaType: ${mediaType}`);
        }
        imageBuffer = Buffer.from(base64, 'base64');
        ext = MEDIA_TYPE_EXT[mediaType];
      } else {
        return fail('Provide either filePath or base64 + mediaType');
      }

      const imageId = `${randomUUID()}${ext}`;
      const destPath = path.join(IMAGES_DIR, imageId);
      await fs.promises.writeFile(destPath, imageBuffer);

      const url = `${PUBLIC_API_HOST}/api/images/${imageId}`;
      return ok({ url, markdown: `![${altText}](${url})` });
    },
  };
}
