import { describe, it, expect } from 'vitest';
import { resolveTurnIdForUserCreate } from '../turn-assignment.js';

describe('resolveTurnIdForUserCreate', () => {
  const baseSession = {
    status: 'running',
    review_status: 'idle',
    current_turn_id: 4,
    active_chat_turn_id: 4,
    active_review_turn_id: null,
  };

  it('allocates a new turn when idle', () => {
    const session = { ...baseSession, status: 'active' };
    const r = resolveTurnIdForUserCreate(
      session,
      { type: 'user', message_json: JSON.stringify({ type: 'user', content: 'hi' }) },
      { channel: 'chat' }
    );
    expect(r).toEqual({ turnId: null, increment: true });
  });

  it('reuses active turn for steering while running', () => {
    const r = resolveTurnIdForUserCreate(
      baseSession,
      { type: 'user', message_json: JSON.stringify({ type: 'user', content: 'steer' }) },
      { channel: 'chat', force: true }
    );
    expect(r).toEqual({ turnId: 4, increment: false });
  });

  it('reuses active turn for baguette messages while running', () => {
    const r = resolveTurnIdForUserCreate(
      baseSession,
      {
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          source: 'baguette',
          content: 'note',
        }),
      },
      { channel: 'chat' }
    );
    expect(r).toEqual({ turnId: 4, increment: false });
  });
});
