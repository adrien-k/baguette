import { describe, it, expect } from 'vitest';
import { pickAgentConfigIdForSessionBackfill } from '../agent-config-backfill.js';

describe('pickAgentConfigIdForSessionBackfill', () => {
  it('prefers Claude auth-token config when only token exists', () => {
    const scope = { primary: null, token: 42, cursor: null, pi: null };
    expect(pickAgentConfigIdForSessionBackfill(scope, undefined, 'claude')).toBe(42);
  });

  it('prefers Claude API-key config when only primary exists', () => {
    const scope = { primary: 11, token: null, cursor: null, pi: null };
    expect(pickAgentConfigIdForSessionBackfill(scope, undefined, 'claude')).toBe(11);
  });

  it('prefers primary when both Claude configs exist', () => {
    const scope = { primary: 11, token: 42, cursor: null, pi: null };
    expect(pickAgentConfigIdForSessionBackfill(scope, undefined, 'claude')).toBe(11);
  });

  it('uses repo scope before account scope', () => {
    const repo = { primary: 1, token: null, cursor: null, pi: null };
    const account = { primary: 2, token: null, cursor: null, pi: null };
    expect(pickAgentConfigIdForSessionBackfill(repo, account, 'claude')).toBe(1);
  });
});
