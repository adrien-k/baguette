import { describe, it, expect } from 'vitest';
import { isMcpUserMessagePayload } from '../agent-subagent-messages.js';

describe('isMcpUserMessagePayload', () => {
  it('detects subtype mcp on the row', () => {
    expect(isMcpUserMessagePayload({ subtype: 'mcp', message_json: '{}' })).toBe(true);
  });

  it('detects mcp source in message_json', () => {
    expect(
      isMcpUserMessagePayload({
        message_json: JSON.stringify({ type: 'user', source: 'mcp', content: 'hi' }),
      })
    ).toBe(true);
  });

  it('returns false for normal UI messages', () => {
    expect(
      isMcpUserMessagePayload({
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'hi' },
        }),
      })
    ).toBe(false);
  });
});
