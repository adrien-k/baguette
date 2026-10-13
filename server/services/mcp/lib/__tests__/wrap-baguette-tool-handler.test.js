import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../feathers/agents.service.js', () => ({
  patchAgentInternal: vi.fn().mockResolvedValue({}),
}));

import { patchAgentInternal } from '../../../feathers/agents.service.js';
import { wrapBaguetteToolList } from '../wrap-baguette-tool-handler.js';

function makeDb({ sessionRow, builder, reviewer }) {
  return (table) => {
    if (table === 'sessions') {
      return {
        where: () => ({
          first: async () => sessionRow,
        }),
      };
    }
    if (table === 'agents') {
      return {
        where: (query) => ({
          first: async () => {
            if (query.is_primary === 1) return builder;
            if (query.agent_type === 'reviewer') return reviewer;
            return null;
          },
        }),
      };
    }
    return { where: () => ({ first: async () => null }) };
  };
}

describe('wrapBaguetteToolList', () => {
  it('marks awaiting user after AskUserQuestions without aborting the agent', async () => {
    const abort = vi.fn();
    const sessionState = {
      channel: 'chat',
      endTurnAwaitingUser: false,
      abortController: { abort },
    };
    const builder = { id: 5, agent_sdk: 'cursor', agent_type: 'builder', session_id: 42 };
    const app = {
      get: (key) => {
        if (key === 'db') {
          return makeDb({ sessionRow: { id: 42 }, builder, reviewer: null });
        }
        return undefined;
      },
      service: (name) => {
        if (name === 'cursor-agent') {
          return { getActiveSession: () => sessionState };
        }
        return null;
      },
    };
    const session = { id: 42, user_id: 7 };
    const tools = wrapBaguetteToolList(session, app, [
      {
        name: 'AskUserQuestions',
        description: 'ask',
        schema: {},
        handler: async () => ({ ok: true }),
      },
    ]);

    await tools[0].handler({ questions: [{ question: 'Go?' }] });

    expect(sessionState.endTurnAwaitingUser).toBe(true);
    expect(sessionState.agentId).toBe(5);
    expect(patchAgentInternal).toHaveBeenCalledWith(app, 5, { status: 'approval' }, 7);
    expect(abort).not.toHaveBeenCalled();
  });

  it('finds review-turn active session state via reviewTurnKey', async () => {
    const sessionState = { turnChannel: 'review', endTurnAwaitingUser: false };
    const getActiveSession = vi.fn((key) => {
      if (key === 'review:99') return sessionState;
      return null;
    });
    const builder = { id: 10, agent_sdk: 'claude', agent_type: 'builder', session_id: 42 };
    const reviewer = { id: 99, agent_sdk: 'claude', agent_type: 'reviewer', session_id: 42 };
    const app = {
      get: (key) => {
        if (key === 'db') {
          return makeDb({ sessionRow: { id: 42 }, builder, reviewer });
        }
        return undefined;
      },
      service: (name) => {
        if (name === 'claude-agent') return { getActiveSession };
        return null;
      },
    };
    const session = { id: 42, user_id: 7 };
    const tools = wrapBaguetteToolList(session, app, [
      {
        name: 'AskUserQuestions',
        description: 'ask',
        schema: {},
        handler: async () => ({ ok: true }),
      },
    ]);

    await tools[0].handler({ questions: [{ question: 'Go?' }] });

    expect(getActiveSession).toHaveBeenCalledWith(42);
    expect(getActiveSession).toHaveBeenCalledWith('review:99');
    expect(sessionState.endTurnAwaitingUser).toBe(true);
    expect(sessionState.agentId).toBe(99);
    expect(patchAgentInternal).toHaveBeenCalledWith(app, 99, { status: 'approval' }, 7);
  });

  it('does not patch approval when no active agent session exists', async () => {
    patchAgentInternal.mockClear();
    const builder = { id: 5, agent_sdk: 'cursor', agent_type: 'builder', session_id: 42 };
    const app = {
      get: (key) => {
        if (key === 'db') {
          return makeDb({ sessionRow: { id: 42 }, builder, reviewer: null });
        }
        return undefined;
      },
      service: (name) => {
        if (name === 'cursor-agent') return { getActiveSession: () => null };
        return null;
      },
    };
    const session = { id: 42, user_id: 7 };
    const tools = wrapBaguetteToolList(session, app, [
      {
        name: 'CreatePlan',
        description: 'plan',
        schema: {},
        handler: async () => ({ ok: true }),
      },
    ]);

    await tools[0].handler({ markdown: '# Plan' });

    expect(patchAgentInternal).not.toHaveBeenCalled();
  });

  it('does not mark awaiting user for non turn-ending tools', async () => {
    patchAgentInternal.mockClear();
    const sessionState = { channel: 'chat', endTurnAwaitingUser: false };
    const builder = { id: 5, agent_sdk: 'cursor', agent_type: 'builder', session_id: 1 };
    const app = {
      get: (key) => {
        if (key === 'db') {
          return makeDb({ sessionRow: { id: 1 }, builder, reviewer: null });
        }
        return undefined;
      },
      service: () => ({ getActiveSession: () => sessionState }),
    };
    const session = { id: 1, user_id: 2 };
    const tools = wrapBaguetteToolList(session, app, [
      {
        name: 'ListTodos',
        description: 'list',
        schema: {},
        handler: async () => ({ ok: true }),
      },
    ]);

    await tools[0].handler({});

    expect(sessionState.endTurnAwaitingUser).toBe(false);
    expect(patchAgentInternal).not.toHaveBeenCalled();
  });
});
