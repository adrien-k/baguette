/**
 * Live Pi SDK turn. Skips unless SDK_TESTS_PI_* are set (see `.env.example`).
 *
 * Recommended (OpenCode Go):
 *   SDK_TESTS_PI_API_KEY_ENV_VAR=OPENCODE_GO_API_KEY
 *   SDK_TESTS_PI_MODEL=opencode-go/glm-5.3-flash
 * Observed 2026-10-31: ~$0.0051 / builder turn (glm-5.3-flash via OpenCode Go).
 */
import { describe, it } from 'vitest';
import { liveSdkSuiteTimeoutMs, readLiveSdkEnv } from '../../../test-utils/sdk-live-env.js';

const env = readLiveSdkEnv('pi');

describe.skipIf(!env.enabled)('pi live SDK', () => {
  it(
    'listModels, connectivity, builder turn, and reviewer turn',
    { timeout: liveSdkSuiteTimeoutMs(env) },
    async () => {
      const { runLiveSdkSuite } = await import('../../../test-utils/sdk-live.js');
      await runLiveSdkSuite('pi');
    }
  );
});
