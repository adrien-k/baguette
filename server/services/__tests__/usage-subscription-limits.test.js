import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerUsageService } from '../feathers/usage.service.js';
import { registerSdkPlugin } from '../../agent-sdks/registry.js';
import { clearSubscriptionLimitsCache } from '../../lib/subscription-limits.js';

const db = createTestDb();
const fetchSubscriptionLimits = vi.fn();

registerSdkPlugin({
  key: 'limits-test-sdk',
  label: 'Limits Test',
  servicePath: 'limits-test-agent',
  fetchSubscriptionLimits,
});

describe('usage.subscriptionLimits', () => {
  let app;
  let userId;

  beforeEach(async () => {
    clearSubscriptionLimitsCache();
    fetchSubscriptionLimits.mockReset();
    fetchSubscriptionLimits.mockResolvedValue({
      status: 'ok',
      message: null,
      limits: [{ id: 'session', label: 'Session (5h)', percent: 10 }],
    });
    await db('users').insert({ github_id: 7, username: 'bob', status: 'approved' });
    userId = (await db('users').where({ username: 'bob' }).first()).id;
    app = feathers();
    app.set('db', db);
    registerUsageService(app);
    await app.setup();
  });

  const call = (data = {}) =>
    app.service('usage').subscriptionLimits(data, { user: { id: userId } });

  it('adds the agent config name to the provider account info', async () => {
    await db('agent_configs').insert({
      user_id: userId,
      label: 'Work Claude',
      sdk: 'limits-test-sdk',
    });
    fetchSubscriptionLimits.mockResolvedValue({
      status: 'ok',
      message: null,
      limits: [],
      account: { email: 'me@example.com', plan: 'pro' },
    });
    const { providers } = await call({ agent_sdk: 'limits-test-sdk' });
    expect(providers[0].account).toEqual({
      name: 'Work Claude',
      email: 'me@example.com',
      plan: 'pro',
    });
  });

  it('returns one entry per plugin that can report limits, with a refresh time', async () => {
    const { providers } = await call();
    const entry = providers.find((p) => p.sdk === 'limits-test-sdk');
    expect(entry).toMatchObject({ label: 'Limits Test', status: 'ok' });
    expect(entry.limits[0].percent).toBe(10);
    expect(entry.refreshed_at).toBeTruthy();
  });

  it('returns only the requested agent_sdk', async () => {
    const { providers } = await call({ agent_sdk: 'limits-test-sdk' });
    expect(providers.map((p) => p.sdk)).toEqual(['limits-test-sdk']);
    expect((await call({ agent_sdk: 'unknown-sdk' })).providers).toEqual([]);
  });

  it('caches until refresh is requested', async () => {
    await call();
    await call();
    expect(fetchSubscriptionLimits).toHaveBeenCalledTimes(1);
    await call({ refresh: true });
    expect(fetchSubscriptionLimits).toHaveBeenCalledTimes(2);
  });

  it('isolates a failing provider as an error entry', async () => {
    fetchSubscriptionLimits.mockRejectedValue(new Error('boom'));
    const { providers } = await call();
    expect(providers.find((p) => p.sdk === 'limits-test-sdk')).toMatchObject({
      status: 'error',
      message: 'boom',
    });
  });
});
