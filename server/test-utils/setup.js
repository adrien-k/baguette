import { expect, vi } from 'vitest';
import { isFeathersBadRequest, isFeathersNotFound } from './feathers-errors.js';

// Keep a developer's local .env from changing host-dependent URLs (dotenv never overrides set vars).
process.env.PUBLIC_HOST = 'http://localhost:3000';

// Ensures the SDK is not called in tests.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

expect.extend({
  toBeNotFoundError(received) {
    const pass = isFeathersNotFound(received);
    return {
      pass,
      message: () =>
        pass
          ? `expected error not to be Feathers NotFound`
          : `expected Feathers NotFound, got ${received?.name ?? received}`,
    };
  },
  toBeBadRequestError(received) {
    const pass = isFeathersBadRequest(received);
    return {
      pass,
      message: () =>
        pass
          ? `expected error not to be Feathers BadRequest`
          : `expected Feathers BadRequest, got ${received?.name ?? received}`,
    };
  },
});
