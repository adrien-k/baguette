import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resourceLoaderArgs = [];

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(async () => ({
    session: {
      sessionId: 'pi-mcp-1',
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
    },
  })),
  createMcpExtension: vi.fn((options) => ({ __mcpExtension: true, options })),
  SessionManager: {
    create: vi.fn(() => ({ getCwd: () => '/tmp' })),
    findById: vi.fn(),
    open: vi.fn(),
    inMemory: vi.fn(),
  },
  SettingsManager: { create: vi.fn(() => ({})) },
  DefaultResourceLoader: class {
    constructor(options) {
      resourceLoaderArgs.push(options);
      Object.assign(this, options);
    }
    reload() {
      return Promise.resolve();
    }
  },
}));

vi.mock('../models.js', () => ({
  createPiModelRuntime: vi.fn().mockResolvedValue({}),
  resolvePiSessionModel: vi
    .fn()
    .mockResolvedValue({ model: { id: 'test-model' }, thinkingLevel: 'off' }),
}));

vi.mock('../adapt-tools.js', () => ({
  toolListToPiCustomTools: vi.fn(() => []),
}));

import { PiDriver } from '../driver.ts';

describe('PiDriver user MCP servers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourceLoaderArgs.length = 0;
  });

  it('writes enabled servers into the Pi agent mcp.json with direct exposure', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baguette-pi-mcp-'));
    const sessionPath = path.join(root, 'worktree');
    const app = {
      get: () => null,
      service: () => ({}),
    };
    const driver = new PiDriver(app, { api_key: 'sk-test', api_key_env_var: null });

    await driver.start({
      app,
      sdk: 'pi',
      session: { id: 1, user_id: 2, session_path: sessionPath },
      agent: {
        id: 1,
        session_id: 1,
        name: 'builder',
        agent_type: 'builder',
        is_primary: 1,
        status: 'idle',
      },
      channel: 'chat',
      userId: 2,
      turnId: 1,
      turnModel: { model: 'claude-haiku-4-5', modelParams: null },
      turnAgentConfigId: 1,
      cwd: sessionPath,
      userMcpServers: {
        docs: {
          type: 'http',
          url: 'https://mcp.example/mcp',
          description: 'Query the fixture store instead of writing SQL by hand.',
        },
      },
      baguetteTools: [],
    });

    await driver.newSession({ cwd: sessionPath, model: 'claude-haiku-4-5' });

    const mcpPath = path.join(root, 'pi-agent', 'config', 'mcp.json');
    const written = JSON.parse(await fs.readFile(mcpPath, 'utf8'));
    expect(written).toEqual({
      mcpServers: {
        docs: {
          type: 'http',
          exposure: 'direct',
          url: 'https://mcp.example/mcp',
          description: 'Query the fixture store instead of writing SQL by hand.',
        },
      },
    });

    expect(resourceLoaderArgs[0]?.extensionFactories?.length).toBeGreaterThanOrEqual(2);
  });
});
