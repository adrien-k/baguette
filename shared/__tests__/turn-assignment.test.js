import { describe, it, expect } from 'vitest';
import { resolveTurnIdForUserCreate } from '../turn-assignment.js';

describe('resolveTurnIdForUserCreate', () => {
  const runningBuilder = {
    agent_type: 'builder',
    status: 'running',
    active_turn_id: 4,
    current_turn_id: 4,
  };

  it('allocates a new turn when idle', () => {
    const agent = { agent_type: 'builder', status: 'stopped', active_turn_id: null };
    const r = resolveTurnIdForUserCreate(
      agent,
      { type: 'user', message_json: JSON.stringify({ type: 'user', content: 'hi' }) },
      {}
    );
    expect(r).toEqual({ turnId: null, increment: true });
  });

  it('reuses active turn for steering while running', () => {
    const r = resolveTurnIdForUserCreate(
      runningBuilder,
      { type: 'user', message_json: JSON.stringify({ type: 'user', content: 'steer' }) },
      { force: true }
    );
    expect(r).toEqual({ turnId: 4, increment: false });
  });

  it('reuses active turn for baguette messages while running', () => {
    const r = resolveTurnIdForUserCreate(
      runningBuilder,
      {
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          source: 'baguette',
          content: 'note',
        }),
      },
      {}
    );
    expect(r).toEqual({ turnId: 4, increment: false });
  });

  it('allocates a new turn for MCP messages when idle', () => {
    const agent = { agent_type: 'builder', status: 'stopped', active_turn_id: null };
    const r = resolveTurnIdForUserCreate(
      agent,
      {
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          source: 'mcp',
          content: 'hello',
          subtype: 'mcp',
        }),
      },
      {}
    );
    expect(r).toEqual({ turnId: null, increment: true });
  });

  it('allocates a new turn for MCP messages while builder is running', () => {
    const r = resolveTurnIdForUserCreate(
      runningBuilder,
      {
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          source: 'mcp',
          content: 'hello',
          subtype: 'mcp',
        }),
      },
      {}
    );
    expect(r).toEqual({ turnId: null, increment: true });
  });

  it('reuses active turn for forced MCP messages while running (steering)', () => {
    const r = resolveTurnIdForUserCreate(
      runningBuilder,
      {
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          source: 'mcp',
          content: 'steer',
          subtype: 'mcp',
        }),
      },
      { force: true }
    );
    expect(r).toEqual({ turnId: 4, increment: false });
  });

  it('reuses active_turn_id for human follow-ups while review is running', () => {
    const reviewer = {
      agent_type: 'reviewer',
      status: 'running',
      active_turn_id: 4,
      current_turn_id: 4,
    };
    const { turnId, increment } = resolveTurnIdForUserCreate(
      reviewer,
      {
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'follow up' }),
      },
      {}
    );
    expect(increment).toBe(false);
    expect(turnId).toBe(4);
  });
});
