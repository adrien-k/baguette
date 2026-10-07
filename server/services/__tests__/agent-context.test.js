import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/encrypt.js', () => ({
  encrypt: vi.fn((v) => `enc:${v}`),
  decrypt: vi.fn((v) => v?.replace?.(/^enc:/, '') ?? v),
}));

import { userRowForAgentSdk } from '../agent-sdk/agent-context.js';

describe('userRowForAgentSdk', () => {
  it('includes decrypted Pi credentials from the user row', () => {
    const user = userRowForAgentSdk({
      id: 1,
      pi_api_key_encrypted: 'enc:pi-secret',
      pi_api_key_env_var: 'OPENAI_API_KEY',
    });
    expect(user.pi_api_key).toBe('pi-secret');
    expect(user.pi_api_key_env_var).toBe('OPENAI_API_KEY');
  });
});
