import { describe, it, expect } from 'vitest';
import { shouldShowPendingInitialPrompt } from '../pendingInitialPrompt.js';

describe('shouldShowPendingInitialPrompt', () => {
  const session = { initial_prompt: 'Fix the login bug' };
  const primary = { id: 1, is_primary: 1, agent_type: 'builder' };
  const subagent = { id: 2, is_primary: 0, agent_type: 'subagent' };

  it('shows when there is a prompt and no turn-starting user message', () => {
    expect(
      shouldShowPendingInitialPrompt({
        session,
        messages: [{ type: 'system', subtype: 'status' }],
        activeAgent: primary,
      })
    ).toBe(true);
  });

  it('hides when the first user message exists', () => {
    expect(
      shouldShowPendingInitialPrompt({
        session,
        messages: [{ type: 'user', message: { role: 'user', content: 'Fix the login bug' } }],
        activeAgent: primary,
      })
    ).toBe(false);
  });

  it('hides on non-primary agent chat', () => {
    expect(
      shouldShowPendingInitialPrompt({
        session,
        messages: [],
        activeAgent: subagent,
      })
    ).toBe(false);
  });

  it('hides when initial_prompt is empty', () => {
    expect(
      shouldShowPendingInitialPrompt({
        session: { initial_prompt: '  ' },
        messages: [],
        activeAgent: primary,
      })
    ).toBe(false);
  });

  it('shows for primary view when activeAgent is missing', () => {
    expect(
      shouldShowPendingInitialPrompt({
        session,
        messages: [],
        activeAgent: null,
      })
    ).toBe(true);
  });
});
