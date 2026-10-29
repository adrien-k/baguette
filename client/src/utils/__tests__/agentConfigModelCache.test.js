import { describe, it, expect } from 'vitest';
import { modelsKeptForFetch, shouldFetchModels } from '../agentConfigModelCache.js';

describe('shouldFetchModels', () => {
  it('skips a list that is already loading or ready', () => {
    expect(shouldFetchModels('loading')).toBe(false);
    expect(shouldFetchModels('ready')).toBe(false);
    expect(shouldFetchModels('loading', { force: true })).toBe(false);
  });

  it('loads when idle, missing, or failed', () => {
    expect(shouldFetchModels(undefined)).toBe(true);
    expect(shouldFetchModels('idle')).toBe(true);
    expect(shouldFetchModels('error')).toBe(true);
  });

  it('refetches a ready list when forced', () => {
    expect(shouldFetchModels('ready', { force: true })).toBe(true);
    expect(shouldFetchModels('error', { force: true })).toBe(true);
  });
});

describe('modelsKeptForFetch', () => {
  it('keeps the previous list during a refetch', () => {
    const models = [{ id: 'composer-2.5' }];
    expect(modelsKeptForFetch({ models, status: 'ready' })).toEqual(models);
    expect(modelsKeptForFetch({ models, status: 'error' })).toEqual(models);
  });

  it('starts empty when nothing has loaded', () => {
    expect(modelsKeptForFetch(undefined)).toEqual([]);
    expect(modelsKeptForFetch({ status: 'idle' })).toEqual([]);
  });
});
