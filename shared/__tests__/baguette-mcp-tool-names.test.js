import { describe, expect, it } from 'vitest';

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
});
