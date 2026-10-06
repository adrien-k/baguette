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
});
