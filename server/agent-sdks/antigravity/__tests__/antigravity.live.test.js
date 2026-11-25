/**
 * Live Antigravity SDK turn via `agy acp`.
 * Skips unless SDK_TESTS_ANTIGRAVITY_MODEL or SDK_TESTS_ANTIGRAVITY=1 is set (see `.env.example`).
 */
import { describe, it } from 'vitest';
import {
  liveBashStdoutTimeoutMs,
  liveSdkSuiteTimeoutMs,
  readLiveSdkEnv,
} from '../../../test-utils/sdk-live-env.js';

const env = readLiveSdkEnv('antigravity');

describe.skipIf(!env.enabled)('antigravity live SDK', () => {
  it(
    'listModels, connectivity, completeText, builder turn, and reviewer turn',
    { timeout: liveSdkSuiteTimeoutMs(env) },
    async () => {
      const { runLiveSdkSuite } = await import('../../../test-utils/sdk-live.js');
      await runLiveSdkSuite('antigravity');
    }
  );

  it(
    'persists bash stdout on completed bash tool_call rows',
    { timeout: liveBashStdoutTimeoutMs(env) },
    async () => {
      const { runLiveBashStdoutSuite } = await import('../../../test-utils/sdk-live.js');
      await runLiveBashStdoutSuite('antigravity');
    }
  );
});
