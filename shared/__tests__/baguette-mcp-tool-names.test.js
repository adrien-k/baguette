import { describe, expect, it } from 'vitest';

import { ok } from '../../server/services/baguette-mcp-tool-result.js';
import {
  baguettePlanToolIsInteractive,
  baguetteToolPausesForUserAfterSuccess,
} from '../baguette-mcp-tool-names.js';

describe('baguettePlanToolIsInteractive', () => {
  it('defaults to interactive', () => {
    expect(baguettePlanToolIsInteractive(undefined)).toBe(true);
    expect(baguettePlanToolIsInteractive({})).toBe(true);
    expect(baguettePlanToolIsInteractive({ interactive: true })).toBe(true);
  });

  it('is non-interactive when interactive is false', () => {
    expect(baguettePlanToolIsInteractive({ interactive: false })).toBe(false);
  });
});

describe('baguetteToolPausesForUserAfterSuccess', () => {
  it('still pauses for AskUserQuestions', () => {
    expect(baguetteToolPausesForUserAfterSuccess('AskUserQuestions', {})).toBe(true);
  });

  it('pauses for CreatePlan by default', () => {
    expect(baguetteToolPausesForUserAfterSuccess('CreatePlan', { markdown: '# x' })).toBe(true);
    expect(baguetteToolPausesForUserAfterSuccess('mcp__baguette__CreatePlan', {})).toBe(true);
  });

  it('does not pause for CreatePlan and EditPlan when interactive is false', () => {
    expect(
      baguetteToolPausesForUserAfterSuccess('CreatePlan', { markdown: '# x', interactive: false })
    ).toBe(false);
    expect(
      baguetteToolPausesForUserAfterSuccess('EditPlan', {
        patches: [{ old_string: 'a', new_string: 'b' }],
        interactive: false,
      })
    ).toBe(false);
  });

  it('ignores non turn-ending tools', () => {
    expect(baguetteToolPausesForUserAfterSuccess('ListTodos', {})).toBe(false);
  });

  it('pauses for GitPush when approval is requested', () => {
    const result = ok({ approval_requested: true, request_id: 'req-1' });
    expect(baguetteToolPausesForUserAfterSuccess('GitPush', {}, result)).toBe(true);
    expect(baguetteToolPausesForUserAfterSuccess('mcp__baguette__GitPush', {}, result)).toBe(true);
  });

  it('does not pause for GitPush on immediate push', () => {
    const result = ok({ branch: 'feature' });
    expect(baguetteToolPausesForUserAfterSuccess('GitPush', {}, result)).toBe(false);
  });
});
