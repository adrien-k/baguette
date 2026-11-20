import { describe, it, expect } from 'vitest';
import { normalizeUserPayloadForStorage } from '../normalize-user-payload.js';

describe('normalizeUserPayloadForStorage', () => {
  describe('messages from Slack', () => {
    const slack = { user_id: 'U1', user_name: 'Jan', text: 'hi', allowed: false, untagged: false };

    it('keeps who wrote it when the content is wrapped in the SDK envelope', () => {
      expect(
        normalizeUserPayloadForStorage({
          type: 'user',
          source: 'slack',
          slack,
          message: { role: 'user', content: 'hi\n\nSlack context' },
        })
      ).toEqual({ type: 'user', content: 'hi\n\nSlack context', source: 'slack', slack });
    });

    it('keeps it for typed content blocks and plain string content too', () => {
      const blocks = [{ type: 'text', text: 'hi' }];
      expect(
        normalizeUserPayloadForStorage({ type: 'user', source: 'slack', slack, content: blocks })
      ).toMatchObject({ source: 'slack', slack, content: blocks });
      expect(
        normalizeUserPayloadForStorage({ type: 'user', source: 'slack', slack, content: 'hi' })
      ).toMatchObject({ source: 'slack', slack });
    });

    it('does not invent the marker for ordinary messages', () => {
      expect(
        normalizeUserPayloadForStorage({ type: 'user', message: { role: 'user', content: 'hi' } })
      ).toEqual({ type: 'user', content: 'hi' });
    });
  });

  it('preserves mcp_sender on MCP user payloads', () => {
    const sender = { kind: 'session', session_id: 1, session_label: 'A' };
    const out = normalizeUserPayloadForStorage({
      type: 'user',
      source: 'mcp',
      content: 'ping',
      mcp_sender: sender,
    });
    expect(out.mcp_sender).toEqual(sender);
  });

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
