/** Default display name for a secondary builder: the first words of the user's prompt. */
export function titleFromPrompt(prompt, maxWords = 4) {
  const words = String(prompt ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'Builder';
  const title = words.slice(0, maxWords).join(' ');
  const maxLen = 120;
  if (title.length <= maxLen) return title;
  return `${title.slice(0, maxLen - 1)}…`;
}
