import { describe, it, expect } from 'vitest';
import {
  getBaguetteToolMessageCompactionHook,
  registerBaguetteToolMessageCompactionHook,
  unregisterBaguetteToolMessageCompactionHook,
} from '../agent-turn-compaction.js';

describe('baguetteToolMessageCompactionHook registry', () => {
  it('stores hooks per session id', async () => {
    const calls = [];
    registerBaguetteToolMessageCompactionHook(10, async () => {
      calls.push(10);
    });
    registerBaguetteToolMessageCompactionHook(20, async () => {
      calls.push(20);
    });
    await getBaguetteToolMessageCompactionHook(10)?.();
    await getBaguetteToolMessageCompactionHook(20)?.();
    expect(calls).toEqual([10, 20]);
    unregisterBaguetteToolMessageCompactionHook(10);
    expect(getBaguetteToolMessageCompactionHook(10)).toBeNull();
    expect(getBaguetteToolMessageCompactionHook(20)).toBeTypeOf('function');
    unregisterBaguetteToolMessageCompactionHook(20);
  });
});
