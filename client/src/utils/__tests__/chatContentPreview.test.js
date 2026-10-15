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

  it('extends preview through a mermaid fence instead of splitting mid-chart', () => {
    const before = Array.from({ length: CHAT_CONTENT_PREVIEW_LINES - 2 }, (_, i) => `p${i}`);
    const mermaidBody = ['  A --> B', '  B --> C', '  C --> D', '  D --> E'];
    const after = ['tail1', 'tail2'];
    const lines = [...before, '```mermaid', ...mermaidBody, '```', ...after];
    const text = lines.join('\n');
    const result = splitPreviewLines(text, CHAT_CONTENT_PREVIEW_LINES);
    const previewLineCount = before.length + 1 + mermaidBody.length + 1;
    expect(result.preview).toBe(lines.slice(0, previewLineCount).join('\n'));
    expect(result.remaining).toBe(after.length);
  });
});
