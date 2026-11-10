import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { ok, fail } from '../lib/result.js';
import {
  SESSION_IMAGE_MEDIA_TYPES,
  MAX_SESSION_IMAGE_BYTES,
  sessionImagePlaceholder,
} from '../../../../shared/session-images.js';

const MEDIA_EXT = SESSION_IMAGE_MEDIA_TYPES;
const EXT_MEDIA = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function normalizeAltText(rawAltText) {
  return String(rawAltText ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolves the handler input to image bytes + media type (path inside the worktree or base64). */
async function resolveImageBytes({ filePath, base64, mediaType }, worktreeRoot) {
  if (filePath) {
    const absPath = path.resolve(worktreeRoot, filePath);
    if (!absPath.startsWith(worktreeRoot + path.sep) && absPath !== worktreeRoot) {
      return { error: fail('filePath must be within the worktree') };
    }
    const ext = path.extname(absPath).toLowerCase();
    const mediaTypeFromExt = EXT_MEDIA[ext];
    if (!mediaTypeFromExt) {
      return {
        error: fail(`Unsupported image extension: ${ext}. Supported: .png .jpg .jpeg .gif .webp`),
      };
    }
    let bytes;
    try {
      bytes = await fs.promises.readFile(absPath);
    } catch {
      return { error: fail(`Could not read file: ${filePath}`) };
    }
    return { bytes, mediaType: mediaTypeFromExt };
  }

  if (base64 && mediaType) {
    if (!MEDIA_EXT[mediaType]) return { error: fail(`Unsupported mediaType: ${mediaType}`) };
    return { bytes: Buffer.from(base64, 'base64'), mediaType };
  }

  return { error: fail('Provide either filePath or base64 + mediaType') };
}

export function createUploadImageTool(ctx) {
  const { getSession, app, absoluteSessionPath } = ctx;
  return {
    name: 'UploadImage',
    description:
      'Persist a screenshot or image for the session pull request description and return an ' +
      '{{image:<id>}} placeholder. Provide either filePath (a path relative to the worktree root, ' +
      'e.g. a screenshot saved by a test or Playwright) or base64 + mediaType for raw image data. ' +
      'Embed the returned placeholder in the description passed to UpdateSession by ' +
      'interpolating the image at the right spot: Baguette attaches the file to the pull request ' +
      'and swaps the placeholder for a GitHub-hosted asset URL when the description syncs, and ' +
      'the Details tab shows it from the local image URL.',
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
      altText: z.string().optional().describe('Alt text for the rendered image'),
    },
    handler: async ({ filePath, base64, mediaType, altText }) => {
      const session = await getSession();
      if (!session?.repo_id && !session?.repo_full_name) {
        return fail('Images can only be attached by repository sessions.');
      }

      const resolved = await resolveImageBytes(
        { filePath, base64, mediaType },
        absoluteSessionPath
      );
      if (resolved.error) return resolved.error;
      const { bytes, mediaType: resolvedMediaType } = resolved;
      if (bytes.length === 0) {
        return fail('Image is empty.');
      }
      if (bytes.length > MAX_SESSION_IMAGE_BYTES) {
        return fail(
          `Image is too large (${(bytes.length / 1024 / 1024).toFixed(1)} MB, max 16 MB). ` +
            'Prefer uploading files from the worktree (screenshot in a file, not base64).'
        );
      }

      let row;
      try {
        row = await app.service('session-images').create(
          {
            session_id: session.id,
            media_type: resolvedMediaType,
            bytes,
            alt_text: normalizeAltText(altText),
          },
          { provider: undefined, user: { id: session.user_id } }
        );
      } catch (err) {
        return fail(`Could not store the image: ${err?.message ?? err}`);
      }

      const placeholder = sessionImagePlaceholder(row.image_slug);
      return ok({
        image_id: row.image_slug,
        placeholder,
        markdown: placeholder,
        alt_text: row.alt_text,
      });
    },
  };
}
