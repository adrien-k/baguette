/**
 * Session images (UploadImage MCP tool → PR description sync).
 *
 * Agents embed a stable placeholder in the session description:
 *
 *     {{image:<image_slug>}}
 *
 * The stored image resolves to different URLs depending on the surface:
 * the Details tab shows the local public image URL, and the GitHub PR body
 * shows the (cached) GitHub-hosted asset URL produced by the gh attach.
 */

/** Supported `--attach` media types and their file extensions. */
export const SESSION_IMAGE_MEDIA_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/** Keep oversized payloads out of the conversation; path-based uploads print advice instead. */
export const MAX_SESSION_IMAGE_BYTES = 16 * 1024 * 1024;

const SESSION_IMAGE_PLACEHOLDER_RE = /\{\{image:([A-Za-z0-9-]+)\}\}/g;

export function sessionImagePlaceholder(imageSlug) {
  return `{{image:${imageSlug}}}`;
}

/** Unique ids across one document, in first-occurrence order. */
export function findSessionImagePlaceholders(text) {
  if (!text) return [];
  const placeholderRe = new RegExp(SESSION_IMAGE_PLACEHOLDER_RE.source, 'g');
  const imageSlugs = [];
  let match;
  while ((match = placeholderRe.exec(text))) imageSlugs.push(match[1]);
  return [...new Set(imageSlugs)];
}

export function hasSessionImagePlaceholders(text) {
  if (!text) return false;
  return new RegExp(SESSION_IMAGE_PLACEHOLDER_RE.source).test(text);
}

/**
 * resolver(imageSlug) → `{ url, alt_text }` or null. Placeholders the resolver
 * cannot resolve (unknown id, failed attach) stay in the text untouched.
 */
export function interpolateSessionImagePlaceholders(text, resolver) {
  if (!text) return text ?? '';
  const placeholderRe = new RegExp(SESSION_IMAGE_PLACEHOLDER_RE.source, 'g');
  return text.replace(placeholderRe, (match, imageSlug) => {
    const resolved = resolver ? resolver(imageSlug) : null;
    const url = resolved?.url;
    const alt = String(resolved?.alt_text ?? '').trim() || 'image';
    return url ? `![${alt}](${url})` : match;
  });
}

/** Plain-text contexts (session list previews) cannot render images — drop them. */
export function stripSessionImagePlaceholders(text) {
  if (!text) return text ?? '';
  const placeholderRe = new RegExp(SESSION_IMAGE_PLACEHOLDER_RE.source, 'g');
  return text.replace(placeholderRe, '');
}

/**
 * The image URL the Details tab renders from — the authenticated,
 * session-scoped file endpoint. Same-origin as the SPA, so `<img>` tags pick
 * up the session cookie automatically.
 */
export function localSessionImageUrl(row, origin = '') {
  const base = origin ? origin.replace(/\/$/, '') : '';
  return `${base}/api/session-images/${row.id}/file`;
}

/** Path of a stored image inside IMAGES_DIR. */
export function sessionImageFileName(imageSlug, fileExt) {
  return `${imageSlug}${fileExt}`;
}

/**
 * The public, unauthenticated image URL the instance serves at
 * `/api/images/:slug.ext` — the same URL embedded in PR bodies when image
 * attach is disabled. Works for every viewer, signed in or not.
 */
export function publicSessionImageUrl(row, origin = '') {
  const base = origin ? origin.replace(/\/$/, '') : '';
  return `${base}/api/images/${row.image_slug}${row.file_ext}`;
}
