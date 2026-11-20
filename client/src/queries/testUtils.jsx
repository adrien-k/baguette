import { QueryClientProvider } from '@tanstack/react-query';
import { createAppQueryClient } from './queryClient.js';

/**
 * QueryClient for tests: no retries (failures resolve fast), fresh cache per
 * test. Built on `createAppQueryClient` so prod defaults stay exercised.
 */
export function createTestQueryClient() {
  const client = createAppQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    queries: { ...defaults.queries, retry: false },
    mutations: { retry: false },
  });
  return client;
}

/** `renderHook`/`render` wrapper providing the given QueryClient. */
export function makeQueryClientWrapper(queryClient) {
  return function QueryClientWrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}
