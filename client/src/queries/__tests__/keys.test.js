import { describe, expect, it } from 'vitest';
import {
  branchKeys,
  currentUserKeys,
  loopKeys,
  messageKeys,
  repoKeys,
  sessionIssueKeys,
  sessionKeys,
  sessionPlanKeys,
  sessionTodoKeys,
  sessionUsageKeys,
  systemInfoKeys,
  taskKeys,
  taskLogKeys,
} from '../keys.js';

/**
 * Guard: every exported key factory exposes only arrays and callable methods.
 * A missing method (e.g. `currentUserKeys.detail`) crashes the app at mount —
 * this test fails fast in CI instead.
 */
describe('query key factories', () => {
  const factories = {
    branchKeys,
    currentUserKeys,
    loopKeys,
    messageKeys,
    repoKeys,
    sessionIssueKeys,
    sessionKeys,
    sessionPlanKeys,
    sessionTodoKeys,
    sessionUsageKeys,
    systemInfoKeys,
    taskKeys,
    taskLogKeys,
  };

  for (const [name, factory] of Object.entries(factories)) {
    it(`${name} exposes arrays and functions only`, () => {
      for (const [key, value] of Object.entries(factory)) {
        expect(
          Array.isArray(value) || typeof value === 'function',
          `${name}.${key} must be an array or function`
        ).toBe(true);
      }
    });
  }

  it('detail-style keys include the id as a string part', () => {
    expect(currentUserKeys.detail(42)).toEqual(['current-user', '42']);
    expect(sessionKeys.detail('abc')).toEqual(['sessions', 'detail', 'abc']);
    expect(sessionKeys.counts(7)).toEqual(['sessions', 'counts', '7']);
    expect(sessionKeys.detail(null)).toEqual(['sessions', 'detail', null]);
  });
});
