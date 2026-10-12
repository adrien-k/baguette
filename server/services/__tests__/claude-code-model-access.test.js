import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query,
}));

import { probeClaudeCodeModelAccess } from '../claude-code-model-access.js';

describe('probeClaudeCodeModelAccess', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('treats model_not_found assistant errors as inaccessible', async () => {
    query.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'assistant', error: 'model_not_found' };
      },
      close: vi.fn(),
    });
    const result = await probeClaudeCodeModelAccess('opus[1m]', { ANTHROPIC_API_KEY: 'k' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('opus[1m]');
  });

  it('accepts a successful result message', async () => {
    query.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', subtype: 'success' };
      },
      close: vi.fn(),
    });
    const result = await probeClaudeCodeModelAccess('sonnet', { ANTHROPIC_API_KEY: 'k' });
    expect(result.ok).toBe(true);
  });
});
