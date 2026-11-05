/** ISO 3166-1 alpha-2 → regional-indicator flag emoji (empty when unknown). */
export function countryCodeToFlagEmoji(code) {
  if (!code || code.length !== 2) return '';
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
