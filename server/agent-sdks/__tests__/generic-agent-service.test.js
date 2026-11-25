import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenericAgentService } from '../generic-agent-service.ts';
import { registerSdkPlugin } from '../registry.js';
import { acpToolCallBuilders } from '../acp-mapping.ts';

registerSdkPlugin({
  key: 'fake',
  label: 'Fake',
  servicePath: 'fake-agent',
  toolCallBuilders: acpToolCallBuilders,
});

function makeFakeApp() {
  const services = new Map();
  const messagesCreated = [];
  const messagesPatched = [];
  const agentsPatched = [];
  const dbUpdates = [];
  const usageCreated = [];
  const emitted = [];

  const mockDb = (table) => {
    const state = { conds: null };
    const builder = {
      where(conds) {
        state.conds = conds;
        return builder;
      },
      whereNotNull() {
        return builder;
      },
      andWhere() {
        return builder;
      },
      limit() {
        return builder;
      },
      select() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      then(resolve, reject) {
        return Promise.resolve([]).then(resolve, reject);
      },
      first: async () => {
        if (table === 'users') {
          return { id: state.conds?.id ?? 10, owner: 1 };
        }
        if (table === 'sessions') {
          return {
            id: state.conds?.id ?? 1,
            user_id: 10,
            status: 'running',
            session_path: null,
          };
        }
        if (table === 'agents') {
          return {
            id: state.conds?.id ?? 2,
            session_id: 1,
            name: 'builder',
            agent_type: 'builder',
            is_primary: 1,
            status: 'idle',
            agent_sdk: 'fake',
            model: 'fake-model',
          };
        }
        if (table === 'agent_configs') {
          return { id: state.conds?.id ?? 5, user_id: 10, sdk: 'fake', api_key_encrypted: null };
        }
        return undefined;
      },
      update: async (patch) => {
        dbUpdates.push({ table, patch });
        return 1;
      },
      increment: async () => 1,
    };
    return builder;
  };

  services.set('messages', {
    create: async (data) => {
      const row = { id: messagesCreated.length + 100, ...data };
      messagesCreated.push(row);
      return row;
    },
    patch: async (id, patch) => {
      messagesPatched.push({ id, patch });
      return { id, ...patch };
    },
  });

  services.set('agents', {
    patch: async (id, patch) => {
      agentsPatched.push({ id, patch });
      return { id, ...patch };
    },
  });

  services.set('sessions', {
    emit: (event, payload) => emitted.push({ event, payload }),
    onTurnStart: async () => {},
    onTurnComplete: async () => {},
    insertUsageRow: async (_session, row) => {
      usageCreated.push(row);
      return 1;
    },
  });

  services.set('usage', {
    create: async (data) => {
      usageCreated.push(data);
      return data;
    },
  });

  const app = {
    get: (key) => (key === 'db' ? mockDb : undefined),
    service: (name) => services.get(name),
    use: () => {},
    emit: (event, payload) => emitted.push({ event, payload }),
    on: () => {},
    services: {},
  };

  return { app, messagesCreated, messagesPatched, agentsPatched, dbUpdates, usageCreated, emitted };
}

describe('GenericAgentService', () => {
  let fakeDriver;
  let updateListener;

  beforeEach(() => {
    updateListener = null;
    fakeDriver = {
      start: vi.fn(async () => {}),
      newSession: vi.fn(async () => ({ sessionId: 'drv-1', storedSessionId: 'stored-1' })),
      resume: vi.fn(async () => ({ sessionId: 'drv-resumed', storedSessionId: 'stored-1' })),
      prompt: vi.fn(async () => {
        updateListener?.({
          sessionId: 'drv-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello from fake driver!' },
          },
        });
        return {
          stopReason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        };
      }),
      onUpdate: vi.fn((cb) => {
        updateListener = cb;
        return () => {
          updateListener = null;
        };
      }),
      cancel: vi.fn(async () => {}),
      closeSession: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      completeText: vi.fn(async () => 'Short title'),
    };
  });

  it('runs a full turn through AgentDriver, streams ACP updates, and cleans up', async () => {
    const { app, messagesCreated, agentsPatched, usageCreated } = makeFakeApp();
    const service = new GenericAgentService({
      key: 'fake',
      label: 'Fake',
      servicePath: 'fake-agent',
      storedSessionIdColumn: 'antigravity_session_id',
      createDriver: () => fakeDriver,
    });
    service.setup(app);

    await service.handleMessageCreated({
      id: 50,
      session_id: 1,
      agent_id: 2,
      turn_id: 7,
      type: 'user',
      agent_sdk: 'fake',
      agent_config_id: 5,
      model: 'fake-model',
      message_json: JSON.stringify({
        type: 'user',
        subtype: 'human',
        message: { role: 'user', content: 'Say hello' },
      }),
    });

    await vi.waitFor(() => {
      expect(fakeDriver.start).toHaveBeenCalledTimes(1);
      expect(fakeDriver.newSession).toHaveBeenCalledTimes(1);
      expect(fakeDriver.prompt).toHaveBeenCalledWith('drv-1', 'Say hello', expect.any(Object));
      expect(fakeDriver.closeSession).toHaveBeenCalledWith('drv-1');
      expect(fakeDriver.close).toHaveBeenCalledTimes(1);
      expect(service.getActiveSession(1)).toBeNull();
    });

    expect(agentsPatched.some((p) => p.patch.antigravity_session_id === 'stored-1')).toBe(true);
    expect(messagesCreated.some((m) => m.message_json?.includes('Hello from fake driver!'))).toBe(
      true
    );
    expect(usageCreated.length).toBe(1);
    expect(usageCreated[0].total_tokens).toBe(15);
  });

  it('delegates completeText to driver and returns empty string if unsupported', async () => {
    const { app } = makeFakeApp();
    const service = new GenericAgentService({
      key: 'fake',
      label: 'Fake',
      servicePath: 'fake-agent',
      createDriver: () => fakeDriver,
    });
    service.setup(app);

    const out = await service.completeText({ userId: 10, prompt: 'Summarize' });
    expect(out).toBe('Short title');
    expect(fakeDriver.close).toHaveBeenCalled();

    delete fakeDriver.completeText;
    const empty = await service.completeText({ userId: 10, prompt: 'Summarize' });
    expect(empty).toBe('');
  });
});
