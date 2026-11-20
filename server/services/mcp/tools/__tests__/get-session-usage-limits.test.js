import { describe, it, expect, vi } from 'vitest';
import { createGetSessionUsageLimitsTool } from '../get-session-usage-limits.js';

const session = {
  id: 7,
  agent_sdk: 'claude',
  agent_config_id: 3,
  usage_limit_action: 'wait',
  usage_limit: 5,
  usage_limit_spent: 1.25,
};
const providers = [{ sdk: 'claude', status: 'ok', limits: [{ id: 'session', percent: 40 }] }];

function setup({ found = true } = {}) {
  const subscriptionLimits = vi.fn().mockResolvedValue({ providers });
  const app = {
    service: (name) =>
      name === 'sessions'
        ? {
            get: vi
              .fn()
              .mockImplementation(async () => (found ? session : Promise.reject(new Error('nf')))),
          }
        : { subscriptionLimits },
  };
  const tool = createGetSessionUsageLimitsTool({ app, userId: 11, callerSession: { id: 7 } });
  return { tool, subscriptionLimits };
}

const body = (res) => JSON.parse(res.content[0].text);

describe('GetSessionUsageLimits', () => {
  it('returns the card data for the current session', async () => {
    const { tool, subscriptionLimits } = setup();
    const res = await tool.handler({});
    expect(subscriptionLimits).toHaveBeenCalledWith(
      { agent_sdk: 'claude', agent_config_id: 3 },
      { user: { id: 11 } }
    );
    expect(body(res)).toEqual({
      ok: true,
      session_id: 7,
      usage_limit_action: 'wait',
      usage_limit: 5,
      usage_limit_spent: 1.25,
      providers,
    });
  });

  it('fails for an unknown or foreign session', async () => {
    const { tool } = setup({ found: false });
    const res = await tool.handler({ session_id: 99 });
    expect(body(res)).toMatchObject({ ok: false, error: 'Session not found. Provide session_id.' });
  });
});
