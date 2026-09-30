import { describe, it, expect } from 'vitest';
import { messageCountsAsSessionActivity } from '../session-activity-message.js';

describe('messageCountsAsSessionActivity', () => {
  it('counts assistant and result rows', () => {
    expect(messageCountsAsSessionActivity({ type: 'assistant', message_json: '{}' })).toBe(true);
    expect(messageCountsAsSessionActivity({ type: 'result', message_json: '{}' })).toBe(true);
  });

  it('counts human and baguette user messages', () => {
    expect(
      messageCountsAsSessionActivity({
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'hi' },
        }),
      })
    ).toBe(true);
    expect(
      messageCountsAsSessionActivity({
        type: 'user',
        message_json: JSON.stringify({ type: 'user', source: 'baguette' }),
      })
    ).toBe(true);
  });

  it('ignores tool results and system messages', () => {
    expect(
      messageCountsAsSessionActivity({
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }],
          },
        }),
      })
    ).toBe(false);
    expect(messageCountsAsSessionActivity({ type: 'system', message_json: '{}' })).toBe(false);
  });
});
