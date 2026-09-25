import { describe, it, expect } from 'vitest';
import {
  createFileReferenceBlock,
  expandUserContentForAgent,
  normalizeUserMessageForAgentSdk,
} from '../user-message-content.js';

describe('user-message-content', () => {
  it('formats file_reference for agents', () => {
    expect(createFileReferenceBlock('src/a.js', 12)).toEqual({
      type: 'file_reference',
      path: 'src/a.js',
      line: 12,
    });
    expect(expandUserContentForAgent([createFileReferenceBlock('src/a.js', 12)])).toBe(
      '@src/a.js:12'
    );
  });

  it('normalizes file_reference in user messages for Claude', () => {
    const parsed = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Check this' }, createFileReferenceBlock('lib/x.ts', 3)],
      },
    };
    const out = normalizeUserMessageForAgentSdk(parsed);
    expect(out.message.content).toEqual([
      { type: 'text', text: 'Check this' },
      { type: 'text', text: '@lib/x.ts:3' },
    ]);
  });
});
