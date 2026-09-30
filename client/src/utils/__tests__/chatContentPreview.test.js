import { describe, it, expect } from 'vitest';
import { CHAT_CONTENT_PREVIEW_LINES, splitPreviewLines } from '../chatContentPreview.js';

describe('splitPreviewLines', () => {
  it('returns full text when within limit', () => {
    const text = 'a\nb\nc';
    expect(splitPreviewLines(text)).toEqual({ preview: text, remaining: 0, lineCount: 3 });
  });

  it('truncates and counts remaining lines', () => {
    const lines = Array.from({ length: CHAT_CONTENT_PREVIEW_LINES + 3 }, (_, i) => `line${i}`);
    const text = lines.join('\n');
    const result = splitPreviewLines(text);
    expect(result.lineCount).toBe(CHAT_CONTENT_PREVIEW_LINES + 3);
    expect(result.remaining).toBe(3);
    expect(result.preview).toBe(lines.slice(0, CHAT_CONTENT_PREVIEW_LINES).join('\n'));
  });
});
