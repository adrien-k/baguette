import { describe, it, expect, vi, beforeEach } from 'vitest';

const listAnthropicApiModels = vi.hoisted(() => vi.fn());
const probeAnthropicMessages = vi.hoisted(() => vi.fn());
vi.mock('../../lib/anthropic-api/models.js', () => ({
  listAnthropicApiModels,
  probeAnthropicMessages,
}));

import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
} from '../../../shared/agent-config-api-key-env.js';
import { runClaudeConnectivityTest } from '../claude-connectivity.js';

beforeEach(() => {
  listAnthropicApiModels.mockReset();
  probeAnthropicMessages.mockReset();
});

describe('runClaudeConnectivityTest', () => {
  it('passes when /v1/models succeeds and reports model count', async () => {
    listAnthropicApiModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5', display_name: 'Sonnet' },
      { id: 'claude-opus-4', display_name: 'Opus' },
    ]);
    const result = await runClaudeConnectivityTest({
      sdk: 'claude',
      api_key: 'sk-ant-api-test',
      api_key_env_var: ANTHROPIC_API_KEY_ENV,
    });
    expect(listAnthropicApiModels).toHaveBeenCalledWith(
      { baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-api-test', authToken: null },
      expect.objectContaining({ limit: 100 })
    );
    expect(probeAnthropicMessages).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['claude-sonnet-4-5', 'claude-opus-4']);
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(byId.auth.ok).toBe(true);
    expect(byId.models.detail).toBe('2 models listed');
  });

  it('falls back to /v1/messages when /v1/models is not supported', async () => {
    const err = new Error('not found');
    err.status = 404;
    listAnthropicApiModels.mockRejectedValue(err);
    probeAnthropicMessages.mockResolvedValue({
      response: { ok: true, status: 200, statusText: 'OK' },
      data: { id: 'msg_1' },
      error: null,
    });
    const result = await runClaudeConnectivityTest({
      sdk: 'claude',
      api_key: 'sk-ant-oat-test',
      api_key_env_var: ANTHROPIC_AUTH_TOKEN_ENV,
      api_url: 'https://gateway.example',
    });
    expect(probeAnthropicMessages).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.base_url).toBe('https://gateway.example');
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(byId.models.ok).toBe(null);
    expect(byId.models.detail).toBe('404 Error');
  });

  it('reports auth failure from /v1/models', async () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    err.apiError = { error: { message: 'invalid x-api-key' } };
    listAnthropicApiModels.mockRejectedValue(err);
    probeAnthropicMessages.mockResolvedValue({
      response: { ok: false, status: 401, statusText: 'Unauthorized' },
      data: null,
      error: { error: { message: 'invalid x-api-key' } },
    });
    const result = await runClaudeConnectivityTest({
      sdk: 'claude',
      api_key: 'bad',
      api_key_env_var: ANTHROPIC_API_KEY_ENV,
    });
    expect(result.ok).toBe(false);
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(byId.auth.ok).toBe(false);
    expect(byId.auth.detail).toBe('invalid x-api-key');
  });
});
