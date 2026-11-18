import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests should never run against production module builds (e.g. React's
// production bundle has no `React.act`, which @testing-library requires).
// Vitest defaults NODE_ENV to 'test' only when it is unset, so pin it here to
// make `pnpm test` independent of the shell environment.
process.env.NODE_ENV = 'test';
// Likewise pin the public host: a developer's `.env` (loaded by server/config.js) must not
// change the preview / redirect URLs the tests assert on.
process.env.PUBLIC_HOST = 'http://localhost:3000';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@baguette/shared': path.resolve(repoRoot, 'shared'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    exclude: ['**/node_modules/**', '**/.data/**', 'e2e/**'],
    setupFiles: ['./server/test-utils/setup.js'],
  },
});
