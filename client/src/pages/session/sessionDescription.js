/**
 * Rewrites absolute Baguette image URLs (`<PUBLIC_API_HOST>/api/images/<id>`)
 * to same-origin paths so they render in the browser even when the API host
 * that generated them is not publicly reachable (local dev, VPN-only hosts).
 */
export function localizeSessionImageUrls(markdown) {
  if (!markdown) return markdown ?? '';
  return markdown.replace(/https?:\/\/[^)\s"'<>]+\/api\/images\/([\w.-]+)/g, '/api/images/$1');
}
