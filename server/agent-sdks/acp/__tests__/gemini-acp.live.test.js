import { describe, it, expect } from 'vitest';
import { createAcpPlugin } from '../create-acp-plugin.ts';
import { AcpProcessDriver } from '../acp-process-driver.ts';

const enabled = Boolean(process.env.SDK_TESTS_GEMINI_ACP);

describe.skipIf(!enabled)('config-only ACP plugin live (Gemini CLI)', () => {
  it('runs a one-shot completion through AcpProcessDriver', async () => {
    const plugin = createAcpPlugin({
      key: 'gemini-cli',
      label: 'Gemini CLI',
      binary: process.env.GEMINI_BIN || 'gemini',
      args: ['--experimental-acp'],
      requiresApiKey: false,
    });
    expect(plugin.key).toBe('gemini-cli');

    const driver = new AcpProcessDriver(
      {
        binary: process.env.GEMINI_BIN || 'gemini',
        args: ['--experimental-acp'],
      },
      null
    );
    const ac = new AbortController();
    const text = await driver.completeText({
      app: { get: () => undefined, service: () => undefined, use: () => {}, emit: () => {} },
      userId: 1,
      cwd: process.cwd(),
      prompt: 'Reply with OK only.',
      signal: ac.signal,
    });
    expect(text.length).toBeGreaterThan(0);
  });
});
