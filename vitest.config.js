import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
    exclude: ['**/node_modules/**', '**/.data/**', '**/.claude/**', 'e2e/**'],
    setupFiles: ['./server/test-utils/setup.js'],
  },
});
