import AnsiToHtml from 'ansi-to-html';

const ansiConverter = new AnsiToHtml({
  fg: 'currentColor',
  bg: 'transparent',
  escapeXML: true,
  stream: false,
});

/**
 * Convert ANSI escape codes to HTML with foreground colors only.
 * Background colors are stripped to avoid distracting blocks from tools like vitest, git, etc.
 */
export function ansiToHtml(text) {
  return ansiConverter.toHtml(text).replace(/\s*background-color:[^;"']*/g, '');
}
