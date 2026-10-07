import { describe, it, expect } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { registerAgentSdksService } from '../feathers/agent-sdks.service.js';
import { firstEnabledAgentSdkKey, resolveAgentSdkKey } from '../agent-sdk/default-agent-sdk.js';

function makeApp() {
  const app = feathers();
  registerAgentSdksService(app);
  app.use(
    'claude-agent',
    {
      async isEnabled({ user }) {
        return Boolean(user?.anthropic_api_key);
      },
      async listModels() {
        return [];
      },
    },
    { methods: ['isEnabled', 'listModels'] }
  );
  app.use(
    'cursor-agent',
    {
      async isEnabled({ user }) {
        return Boolean(user?.cursor_api_key);
      },
      async listModels() {
        return [];
      },
    },
    { methods: ['isEnabled', 'listModels'] }
  );
  app.service('agent-sdks').register({
    key: 'claude',
    label: 'Claude',
    service_path: 'claude-agent',
  });
  app.service('agent-sdks').register({
    key: 'cursor',
    label: 'Cursor',
    service_path: 'cursor-agent',
  });
  return app;
}

describe('default-agent-sdk', () => {
  it('firstEnabledAgentSdkKey returns the first enabled SDK', async () => {
    const app = makeApp();
    const key = await firstEnabledAgentSdkKey(app, {
      user: { id: 1, cursor_api_key: 'k' },
      repo: { id: 1 },
    });
    expect(key).toBe('cursor');
  });

  it('resolveAgentSdkKey falls back when sdk is omitted', async () => {
    const app = makeApp();
    const key = await resolveAgentSdkKey(app, null, {
      user: { id: 1, anthropic_api_key: 'sk' },
      repo: { id: 1 },
    });
    expect(key).toBe('claude');
  });

  it('resolveAgentSdkKey falls back when sdk is not registered', async () => {
    const app = makeApp();
    const key = await resolveAgentSdkKey(app, 'legacy-sdk', {
      user: { id: 1, anthropic_api_key: 'sk' },
      repo: { id: 1 },
    });
    expect(key).toBe('claude');
  });
});
