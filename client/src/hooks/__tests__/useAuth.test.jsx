// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  queryClient: { clear: vi.fn() },
  clearSseConnectionOnLogout: vi.fn(),
}));

vi.mock('../../api.js', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../../queries/queryClientInstance.js', () => ({ queryClient: mocks.queryClient }));
vi.mock('../../feathers.js', () => ({
  clearSseConnectionOnLogout: mocks.clearSseConnectionOnLogout,
}));

import { AuthProvider, useAuth } from '../useAuth.jsx';

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.queryClient.clear.mockClear();
  mocks.clearSseConnectionOnLogout.mockClear();
});

afterEach(cleanup);

const USER_A = { user: { id: 1, username: 'a' } };
const USER_B = { user: { id: 2, username: 'b' } };

describe('AuthProvider query cache clearing', () => {
  it('clears the query cache when the signed-in user changes (logout)', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(USER_A) // initial /auth/me
      .mockResolvedValueOnce({}); // POST /auth/logout

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(1));
    // One clear: identity applied undefined → user A (empty cache, a no-op).
    expect(mocks.queryClient.clear).toHaveBeenCalledTimes(1);
    mocks.queryClient.clear.mockClear();

    await act(async () => {
      await result.current.logout();
    });
    await waitFor(() => expect(result.current.user).toBeNull());
    expect(mocks.queryClient.clear).toHaveBeenCalledTimes(1);
  });

  it('clears the query cache on in-SPA login as another user', async () => {
    mocks.apiFetch.mockResolvedValueOnce(USER_A).mockResolvedValueOnce(USER_B); // refreshAuth after switching accounts

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(1));
    expect(mocks.queryClient.clear).toHaveBeenCalledTimes(1);
    mocks.queryClient.clear.mockClear();

    await act(async () => {
      await result.current.refreshAuth();
    });
    await waitFor(() => expect(result.current.user?.id).toBe(2));
    expect(mocks.queryClient.clear).toHaveBeenCalledTimes(1);
  });

  it('does not clear when refreshAuth keeps the same user id', async () => {
    mocks.apiFetch.mockResolvedValue(USER_B);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(2));
    expect(mocks.queryClient.clear).toHaveBeenCalledTimes(1);
    mocks.queryClient.clear.mockClear();

    await act(async () => {
      await result.current.refreshAuth();
    });
    expect(mocks.queryClient.clear).not.toHaveBeenCalled();
  });
});
