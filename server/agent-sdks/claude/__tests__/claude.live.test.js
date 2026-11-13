/**
 * Live Claude SDK turn. Skips unless SDK_TESTS_CLAUDE_* are set (see `.env.example`).
 *
 * Recommended (OpenCode Go Anthropic gateway — cheapest Claude-compatible Go model):
 *   SDK_TESTS_CLAUDE_AUTH_TOKEN + SDK_TESTS_CLAUDE_API_URL=https://opencode.ai/inference/go/anthropic
 *   SDK_TESTS_CLAUDE_MODEL=claude-haiku-5-5
 * Observed 2026-10-31: ~$0.0038 / builder turn (haiku-5-5 via OpenCode Go).
 */
import { describe, it, vi } from 'vitest';
import { liveSdkSuiteTimeoutMs, readLiveSdkEnv } from '../../../test-utils/sdk-live-env.js';

// setup.js mocks the Claude Agent SDK so unit tests never call the network.
// This file needs the real `query()` implementation when the suite is enabled.
vi.unmock('@anthropic-ai/claude-agent-sdk');

const env = readLiveSdkEnv('claude');

describe.skipIf(!env.enabled)('claude live SDK', () => {
  it(
    'listModels, connectivity, builder turn, and reviewer turn',
    { timeout: liveSdkSuiteTimeoutMs(env) },
    async () => {
      const { runLiveSdkSuite } = await import('../../../test-utils/sdk-live.js');
      await runLiveSdkSuite('claude');
    }
  );
});
