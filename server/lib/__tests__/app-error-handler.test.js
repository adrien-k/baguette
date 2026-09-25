import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubBadCredentialsError } from '../../errors/github-errors.js';
import { handleAppError } from '../../lib/app-error-handler.js';

describe('handleAppError', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits github:bad-credentials for GitHubBadCredentialsError with userId', () => {
    const emit = vi.fn();
    const app = { service: () => ({ emit }) };

    const handled = handleAppError(app, new GitHubBadCredentialsError(), { userId: 3 });

    expect(handled).toBe(true);
    expect(emit).toHaveBeenCalledWith('github:bad-credentials', { user_id: 3 });
  });

  it('debounces duplicate notifications', () => {
    const emit = vi.fn();
    const app = { service: () => ({ emit }) };
    const err = new GitHubBadCredentialsError();

    handleAppError(app, err, { userId: 7 });
    handleAppError(app, err, { userId: 7 });

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('returns false for unknown errors', () => {
    const app = { service: () => ({ emit: vi.fn() }) };
    expect(handleAppError(app, new Error('nope'), { userId: 1 })).toBe(false);
  });
});
