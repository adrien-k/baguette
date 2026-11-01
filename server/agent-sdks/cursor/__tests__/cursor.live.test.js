/**
 * Live Cursor SDK turn. Skips unless SDK_TESTS_CURSOR_* are set (see `.env.example`).
 *
 * Recommended: SDK_TESTS_CURSOR_MODEL=glm-5p3-flash (Cursor catalog id for GLM 5.3 Flash).
 * Observed 2026-10-31: ~$0.0045 / builder turn on glm-5p3-flash; composer-2.5 was ~$0.028.
 */
import { describe, it } from 'vitest';
import { liveSdkSuiteTimeoutMs, readLiveSdkEnv } from '../../../test-utils/sdk-live-env.js';

const env = readLiveSdkEnv('cursor');

describe.skipIf(!env.enabled)('cursor live SDK', () => {
  it(
    'listModels, connectivity, builder turn, and reviewer turn',
    { timeout: liveSdkSuiteTimeoutMs(env) },
    async () => {
      const { runLiveSdkSuite } = await import('../../../test-utils/sdk-live.js');
      await runLiveSdkSuite('cursor');
    }
  );
});
