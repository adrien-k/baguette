/** First capital letter for a letter-fallback avatar. */
export function userAvatarInitial(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return '?';
  return [...trimmed][0].toLocaleUpperCase();
}

/** Stable HSL fill derived from a display name (readable with white lettering). */
export function userAvatarBackground(name) {
  const s = String(name ?? '');
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = Math.imul(31, hash) + s.charCodeAt(i);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 52% 40%)`;
}
