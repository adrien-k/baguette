import { describe, expect, it } from 'vitest';
import { liveSdkSuiteTimeoutMs, readLiveSdkEnv } from '../../../test-utils/sdk-live-env.js';

const env = readLiveSdkEnv('mock');

describe.skipIf(!env.enabled)('mock live SDK', () => {
  it(
    'listModels, connectivity, and builder tool tour',
    { timeout: liveSdkSuiteTimeoutMs(env, { includeReviewer: false }) },
    async () => {
      const { runLiveSdkSuite } = await import('../../../test-utils/sdk-live.js');
      const { toolNames } = await runLiveSdkSuite('mock', {
        includeReviewer: false,
        builder: {
          expectUsage: false,
          expectTodo: false,
          expectTaskTools: false,
          prompt: 'exercise the mock agent turn',
        },
      });
      expect(toolNames.some((n) => /bash|write|task/i.test(n))).toBe(true);
    }
  );
});
