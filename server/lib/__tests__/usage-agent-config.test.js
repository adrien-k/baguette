import { describe, it, expect } from 'vitest';
import {
  requireAgentConfigIdForSession,
  requireAgentConfigIdForTurn,
  reviewTurnAgentConfigId,
  usageAgentConfigIdForSession,
  usageAgentConfigIdForTurn,
} from '../usage-agent-config.js';

describe('usageAgentConfigIdForSession', () => {
  it('returns the builder config for chat', () => {
    expect(usageAgentConfigIdForSession({ agent_config_id: 5 }, 'chat')).toBe(5);
  });

  it('review prefers review_agent_config_id and falls back to the builder config', () => {
    expect(
      usageAgentConfigIdForSession({ agent_config_id: 5, review_agent_config_id: 9 }, 'review')
    ).toBe(9);
    expect(usageAgentConfigIdForSession({ agent_config_id: 5 }, 'review')).toBe(5);
  });

  it('coerces to a number and returns null otherwise', () => {
    expect(usageAgentConfigIdForSession({ agent_config_id: '12' }, undefined)).toBe(12);
    expect(usageAgentConfigIdForSession({ agent_config_id: null }, 'chat')).toBeNull();
    expect(usageAgentConfigIdForSession(null, 'chat')).toBeNull();
  });
});

describe('usageAgentConfigIdForTurn', () => {
  it('prefers the turn snapshot over the session pair', () => {
    expect(usageAgentConfigIdForTurn({ agent_config_id: 5 }, { agentConfigId: 9 })).toBe(9);
    expect(usageAgentConfigIdForTurn({ agent_config_id: 5 }, {})).toBe(5);
    expect(
      usageAgentConfigIdForTurn(
        { agent_config_id: 5, review_agent_config_id: 9 },
        { agentType: 'reviewer' }
      )
    ).toBe(9);
  });
});

describe('reviewTurnAgentConfigId', () => {
  it('uses the explicit review config from the start/send payload', () => {
    expect(reviewTurnAgentConfigId({ agent_config_id: 5 }, { review_agent_config_id: 9 })).toBe(9);
    expect(reviewTurnAgentConfigId({ agent_config_id: 5 }, {})).toBe(5);
  });

  it('ignores non-numeric payloads and falls back to the session', () => {
    expect(reviewTurnAgentConfigId({ agent_config_id: 5 }, { review_agent_config_id: '' })).toBe(5);
  });
});

describe('requireAgentConfigIdForSession / requireAgentConfigIdForTurn', () => {
  it('returns the config id when present', () => {
    expect(requireAgentConfigIdForSession({ agent_config_id: 5 }, 'chat')).toBe(5);
    expect(requireAgentConfigIdForTurn({ agent_config_id: 5 }, {}, 'review')).toBe(5);
  });

  it('throws when the session has no config for the turn', () => {
    expect(() => requireAgentConfigIdForSession({}, 'chat')).toThrow(
      'Agent configuration is required to run this turn'
    );
    expect(() => requireAgentConfigIdForSession({}, { agent_config_id: null }, 'review')).toThrow(
      'Agent configuration is required to run this turn'
    );
  });

  it('prefers the row snapshot and falls back to the session for legacy rows', () => {
    expect(
      requireAgentConfigIdForTurn({ agent_config_id: 5 }, { agent_config_id: 9 }, 'chat')
    ).toBe(9);
    expect(requireAgentConfigIdForTurn({ agent_config_id: 5 }, {}, 'chat')).toBe(5);
  });
});
