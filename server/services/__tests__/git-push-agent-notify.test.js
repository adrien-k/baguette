import { describe, expect, it, vi } from 'vitest';
import { registerSdkPlugin } from '../../agent-sdks/registry.js';
import {
  buildGitPushOutcomeAgentText,
  deliverGitPushOutcomeToAgent,
} from '../git-push-agent-notify.js';

registerSdkPlugin({
  key: 'mock',
  label: 'Mock',
  servicePath: 'mock-agent',
  isEnabled: () => true,
  register: () => {},
});

describe('buildGitPushOutcomeAgentText', () => {
  it('includes detailed error text on failed push', () => {
    const text = buildGitPushOutcomeAgentText({
      outcome: 'failed',
      prevData: {
        request_id: 'req-1',
        target_branch: 'development',
      },
      errorMessage: 'Push rejected: non-fast-forward',
    });
    expect(text).toMatch(/Outcome: failed/);
    expect(text).toMatch(/Push rejected: non-fast-forward/);
    expect(text).toMatch(/request_id: req-1/);
  });

  it('describes canceled approval', () => {
    const text = buildGitPushOutcomeAgentText({
      outcome: 'canceled',
      prevData: { request_id: 'req-2' },
    });
    expect(text).toMatch(/rejected/i);
    expect(text).toMatch(/req-2/);
  });
});

describe('deliverGitPushOutcomeToAgent', () => {
  it('creates a git_push_outcome user message for the tool agent', async () => {
    const create = vi.fn().mockResolvedValue({ id: 501 });
    const agent = {
      id: 9,
      session_id: 7,
      agent_sdk: 'mock',
      agent_type: 'builder',
      model: 'mock',
      agent_config_id: null,
    };
    const db = (table) => {
      if (table === 'agents') {
        return { where: () => ({ first: async () => agent }) };
      }
      return { where: () => ({ first: async () => null }) };
    };
    const app = {
      get: (key) => (key === 'db' ? db : undefined),
      service: (name) => (name === 'messages' ? { create } : null),
    };

    const result = await deliverGitPushOutcomeToAgent(
      app,
      { id: 7, user_id: 3 },
      {
        row: { agent_id: 9 },
        prevData: {
          request_id: 'req-x',
          target_branch: 'development',
        },
        outcome: 'pushed',
      }
    );

    expect(result.delivered).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    const payload = create.mock.calls[0][0];
    expect(payload.subtype).toBe('git_push_outcome');
    expect(payload.session_id).toBe(7);
    expect(payload.agent_id).toBe(9);
    const parsed = JSON.parse(payload.message_json);
    expect(parsed.subtype).toBe('git_push_outcome');
    expect(parsed.outcome).toBe('pushed');
    expect(parsed.content).toMatch(/completed successfully/i);
  });

  it('queues into queued-messages without mutating endTurnAwaitingUser when an active turn is still running', async () => {
    const createMessage = vi.fn();
    const createQueued = vi.fn().mockResolvedValue({ id: 701 });
    const activeSessionState = { endTurnAwaitingUser: true };
    const getActiveSession = vi.fn(() => activeSessionState);
    const agent = {
      id: 9,
      session_id: 7,
      agent_sdk: 'mock',
      agent_type: 'builder',
      is_primary: 1,
      model: 'mock',
      agent_config_id: null,
      active_turn_id: 12,
    };
    const db = (table) => {
      if (table === 'agents') {
        return { where: () => ({ first: async () => agent }) };
      }
      return { where: () => ({ first: async () => null }) };
    };
    const app = {
      get: (key) => (key === 'db' ? db : undefined),
      service: (name) => {
        if (name === 'messages') return { create: createMessage };
        if (name === 'queued-messages') return { create: createQueued };
        if (name === 'mock-agent') return { getActiveSession };
        return null;
      },
    };

    const result = await deliverGitPushOutcomeToAgent(
      app,
      { id: 7, user_id: 3 },
      {
        row: { agent_id: 9 },
        prevData: {
          request_id: 'req-early',
          target_branch: 'development',
        },
        outcome: 'canceled',
      }
    );

    expect(result).toEqual({ delivered: true, queued: true });
    expect(getActiveSession).toHaveBeenCalledWith(7);
    expect(activeSessionState.endTurnAwaitingUser).toBe(true);
    expect(createMessage).not.toHaveBeenCalled();
    expect(createQueued).toHaveBeenCalledOnce();
    const queuedPayload = createQueued.mock.calls[0][0];
    expect(queuedPayload.kind).toBe('turn');
    expect(queuedPayload.session_id).toBe(7);
    expect(queuedPayload.agent_id).toBe(9);
    const parsed = JSON.parse(queuedPayload.message_json);
    expect(parsed.subtype).toBe('git_push_outcome');
    expect(parsed.outcome).toBe('canceled');
  });

  it('queues into queued-messages when active_turn_id is already cleared but active session state still exists', async () => {
    const createMessage = vi.fn();
    const createQueued = vi.fn().mockResolvedValue({ id: 702 });
    const getActiveSession = vi.fn(() => ({ endTurnAwaitingUser: true }));
    const agent = {
      id: 9,
      session_id: 7,
      agent_sdk: 'mock',
      agent_type: 'builder',
      is_primary: 1,
      model: 'mock',
      agent_config_id: null,
      active_turn_id: null,
    };
    const db = (table) => {
      if (table === 'agents') {
        return { where: () => ({ first: async () => agent }) };
      }
      return { where: () => ({ first: async () => null }) };
    };
    const app = {
      get: (key) => (key === 'db' ? db : undefined),
      service: (name) => {
        if (name === 'messages') return { create: createMessage };
        if (name === 'queued-messages') return { create: createQueued };
        if (name === 'mock-agent') return { getActiveSession };
        return null;
      },
    };

    const result = await deliverGitPushOutcomeToAgent(
      app,
      { id: 7, user_id: 3 },
      {
        row: { agent_id: 9 },
        prevData: { request_id: 'req-gap', target_branch: 'development' },
        outcome: 'pushed',
      }
    );

    expect(result).toEqual({ delivered: true, queued: true });
    expect(getActiveSession).toHaveBeenCalledWith(7);
    expect(createMessage).not.toHaveBeenCalled();
    expect(createQueued).toHaveBeenCalledOnce();
  });
});
