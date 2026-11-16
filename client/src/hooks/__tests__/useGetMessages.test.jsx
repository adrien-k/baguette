// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  const makeFind = () => {
    const queue = [];
    const fn = vi.fn(() => {
      const d = deferred();
      queue.push(d);
      return d.promise;
    });
    fn.queue = queue;
    return fn;
  };

  return { messagesFind: makeFind() };
});

vi.mock('../../feathers.js', () => ({
  messagesService: { find: mocks.messagesFind },
}));

import { createTestQueryClient, makeQueryClientWrapper } from '../../queries/testUtils.jsx';
import { useGetMessages } from '../useGetMessages.js';

// React Query batches observer notifications with setTimeout(0); assertions
// after resolving a fetch go through `waitFor`.

const IDS = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i, session_id: 5 }));

let queryClient;

beforeEach(() => {
  mocks.messagesFind.mockClear();
  mocks.messagesFind.queue.length = 0;
  queryClient = createTestQueryClient();
});

afterEach(cleanup);

describe('useGetMessages (React Query)', () => {
  it('loads the newest page ascending and reports hasMore', async () => {
    const { result } = renderHook(() => useGetMessages(5, null), {
      wrapper: makeQueryClientWrapper(queryClient),
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      // Server sends newest-first: ids 200..101.
      mocks.messagesFind.queue[0].resolve({ data: IDS(101, 200).reverse() });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.messages[0].id).toBe(101);
    expect(result.current.messages[result.current.messages.length - 1].id).toBe(200);
    expect(result.current.hasMore).toBe(true);
  });

  it('loadMore prepends older messages via cursor pagination', async () => {
    const { result } = renderHook(() => useGetMessages(5, null), {
      wrapper: makeQueryClientWrapper(queryClient),
    });
    await act(async () => {
      mocks.messagesFind.queue[0].resolve({ data: IDS(101, 200).reverse() });
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());
    await waitFor(() => expect(mocks.messagesFind).toHaveBeenCalledTimes(2));
    expect(mocks.messagesFind).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ id: { $lt: 101 }, $sort: { id: -1 } }),
    });

    await act(async () => {
      // Partial page (< PAGE_SIZE) ends the cursor chain.
      mocks.messagesFind.queue[1].resolve({ data: IDS(1, 50).reverse() });
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(150));

    expect(result.current.messages[0].id).toBe(1);
    expect(result.current.messages[149].id).toBe(200);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingMore).toBe(false);
  });

  it('is inert when skipped or without a session', () => {
    const { result } = renderHook(() => useGetMessages(null, null, { skip: true }), {
      wrapper: makeQueryClientWrapper(queryClient),
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasMore).toBe(false);
    expect(mocks.messagesFind).not.toHaveBeenCalled();
  });
});
