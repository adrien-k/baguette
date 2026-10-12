import { describe, expect, it, vi } from 'vitest';
import { wrapBaguetteToolList } from '../wrap-baguette-tool-handler.js';

describe('wrapBaguetteToolList', () => {
  it('marks awaiting user after AskUserQuestions without aborting the agent', async () => {
    const patch = vi.fn().mockResolvedValue({});
    const abort = vi.fn();
    const sessionState = {
      channel: 'chat',
      endTurnAwaitingUser: false,
      abortController: { abort },
    };
    const app = {
      get: (key) => {
        if (key === 'db') {
          return () => ({
            where: () => ({
              first: async () => ({ agent_sdk: 'cursor' }),
            }),
          });
        }
        return undefined;
      },
      service: (name) => {
        if (name === 'sessions') return { patch };
        if (name === 'cursor-agent') {
          return { getActiveSession: () => sessionState };
        }
        return null;
      },
    };
    const session = { id: 42, user_id: 7, agent_sdk: 'cursor' };
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
    expect(patch).toHaveBeenCalledWith(
      42,
      { status: 'approval' },
      { provider: undefined, user: { id: 7 } }
    );
    expect(abort).not.toHaveBeenCalled();
  });

  it('finds review-turn active session state via reviewTurnKey', async () => {
    const patch = vi.fn().mockResolvedValue({});
    const sessionState = { turnChannel: 'review', endTurnAwaitingUser: false };
    const getActiveSession = vi.fn((key) => {
      if (key === 'review:42') return sessionState;
      return null;
    });
    const app = {
      get: (key) => {
        if (key === 'db') {
          return () => ({
            where: () => ({
              first: async () => ({ agent_sdk: 'claude' }),
            }),
          });
        }
        return undefined;
      },
      service: (name) => {
        if (name === 'sessions') return { patch };
        if (name === 'claude-agent') return { getActiveSession };
        return null;
      },
    };
    const session = { id: 42, user_id: 7, agent_sdk: 'claude' };
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
    expect(getActiveSession).toHaveBeenCalledWith('review:42');
    expect(sessionState.endTurnAwaitingUser).toBe(true);
    expect(patch).toHaveBeenCalled();
  });

  it('does not patch approval when no active agent session exists', async () => {
    const patch = vi.fn();
    const app = {
      get: (key) => {
        if (key === 'db') {
          return () => ({
            where: () => ({
              first: async () => ({ agent_sdk: 'cursor' }),
            }),
          });
        }
        return undefined;
      },
      service: (name) => {
        if (name === 'sessions') return { patch };
        if (name === 'cursor-agent') return { getActiveSession: () => null };
        return null;
      },
    };
    const session = { id: 42, user_id: 7, agent_sdk: 'cursor' };
    const tools = wrapBaguetteToolList(session, app, [
      {
        name: 'CreatePlan',
        description: 'plan',
        schema: {},
        handler: async () => ({ ok: true }),
      },
    ]);

    await tools[0].handler({ markdown: '# Plan' });

    expect(patch).not.toHaveBeenCalled();
  });

  it('does not mark awaiting user for non turn-ending tools', async () => {
    const patch = vi.fn();
    const sessionState = { channel: 'chat', endTurnAwaitingUser: false };
    const app = {
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
    expect(patch).not.toHaveBeenCalled();
  });
});
