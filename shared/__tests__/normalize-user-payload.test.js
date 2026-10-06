import { describe, it, expect } from 'vitest';
import { normalizeUserPayloadForStorage } from '../normalize-user-payload.js';

describe('normalizeUserPayloadForStorage', () => {
  it('normalizes legacy MCP user envelope to flat content', () => {
    const out = normalizeUserPayloadForStorage({
      type: 'user',
      source: 'mcp',
      message: { role: 'user', content: 'scheduled ping' },
    });
    expect(out).toEqual({
      type: 'user',
      source: 'mcp',
      subtype: 'mcp',
      content: 'scheduled ping',
    });
  });

  it('keeps file_reference blocks in typed content arrays', () => {
    const blocks = [
      { type: 'file_reference', path: 'a.js', line: 1, short_sha: 'deadbeef', change: 'added' },
      { type: 'text', text: 'note' },
    ];
    const out = normalizeUserPayloadForStorage({ type: 'user', content: blocks });
    expect(out.content).toEqual(blocks);
  });

  it('preserves file_reference when normalizing legacy envelope', () => {
    const out = normalizeUserPayloadForStorage({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'file_reference', path: 'b.ts', line: 9, change: 'removed' },
          { type: 'text', text: 'fix' },
        ],
      },
    });
    expect(out.content).toEqual([
      { type: 'file_reference', path: 'b.ts', line: 9, change: 'removed' },
      { type: 'text', text: 'fix' },
    ]);
  });
});
