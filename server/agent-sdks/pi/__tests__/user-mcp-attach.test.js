import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resourceLoaderArgs = [];

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
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
}));

vi.mock('../adapt-tools.js', () => ({
  toolListToPiCustomTools: vi.fn(() => []),
}));

vi.mock('../../../services/mcp/server.js', () => ({
  buildBaguetteToolList: vi.fn(async () => []),
  buildReviewerAgentTools: vi.fn(() => []),
}));

vi.mock('../../../services/mcp/lib/slack.js', () => ({
  loadConfiguredSlackApps: vi.fn(async () => []),
}));

vi.mock('../../../services/session-prompt.js', () => ({
  buildSystemPromptAppend: vi.fn(async () => ''),
}));

const loadEnabledMcpServersForSession = vi.fn();

vi.mock('../../../services/user-mcp-runtime.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadEnabledMcpServersForSession: (...args) => loadEnabledMcpServersForSession(...args),
  };
});

import { PiAgentService } from '../agent-service.ts';
import { createAgentSession } from '@earendil-works/pi-coding-agent';
import { readPiUserMcpConfig } from '../../../services/user-mcp-runtime.js';

describe('PiAgentService user MCP servers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourceLoaderArgs.length = 0;
    loadEnabledMcpServersForSession.mockReset();
  });

  it('writes enabled servers into the Pi agent mcp.json with direct exposure', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baguette-pi-mcp-'));
    const sessionPath = path.join(root, 'worktree');
    loadEnabledMcpServersForSession.mockResolvedValue({
      docs: {
        type: 'http',
        url: 'https://mcp.example/mcp',
        description: 'Query the fixture store instead of writing SQL by hand.',
      },
    });
    const service = new PiAgentService();
    service.app = {
      get() {
        return null;
      },
      service() {
        return {};
      },
    };
    service.loadAgentConfig = async () => ({ api_key: 'sk-test', api_key_env_var: null });
    const options = await service.buildAgentOptions(
      { id: 1, user_id: 2, session_path: sessionPath },
      { customTools: [], agentConfigId: 1, model: 'claude-haiku-4-5', appendSystemPrompt: [] }
    );
    expect(loadEnabledMcpServersForSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 1 }),
      { withDescription: true }
    );
    const mcpPath = path.join(root, 'pi-agent', 'config', 'mcp.json');
    const written = JSON.parse(await fs.readFile(mcpPath, 'utf8'));
    expect(written.mcpServers.docs.url).toBe('https://mcp.example/mcp');
    expect(written.mcpServers.docs.exposure).toBe('direct');
    expect(written.mcpServers.docs.description).toBe(
      'Query the fixture store instead of writing SQL by hand.'
    );
    expect(options.customTools).toEqual([]);
  });

  it('builds the resource loader with an MCP extension factory reading the session mcp.json', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'baguette-pi-mcp-'));
    const sessionPath = path.join(root, 'worktree');
    loadEnabledMcpServersForSession.mockResolvedValue({
      docs: { type: 'http', url: 'https://mcp.example/mcp', description: 'fixture store' },
    });
    const service = new PiAgentService();
    service.app = {
      get() {
        return null;
      },
      service() {
        return {};
      },
    };
    service.loadAgentConfig = async () => ({ api_key: 'sk-test', api_key_env_var: null });
    await service.buildAgentOptions(
      { id: 1, user_id: 2, session_path: sessionPath },
      { customTools: [], agentConfigId: 1, model: 'claude-haiku-4-5', appendSystemPrompt: [] }
    );
    const loaderOptions = resourceLoaderArgs.at(-1);
    expect(loaderOptions).toBeTruthy();
    const factories = loaderOptions.extensionFactories;
    expect(factories).toHaveLength(1);
    expect(factories[0].__mcpExtension).toBe(true);
    // The extension's default loadConfig reads only the global pi agent dir,
    // so the factory must be given the session's agent dir.
    expect(factories[0].options.loadConfig()).toEqual({
      servers: [
        {
          name: 'docs',
          config: {
            type: 'http',
            url: 'https://mcp.example/mcp',
            description: 'fixture store',
            exposure: 'direct',
          },
          source: path.join(root, 'pi-agent', 'config', 'mcp.json'),
          scope: 'global',
        },
      ],
      errors: [],
    });
  });

  it('createOrResumePiSession calls session.bindExtensions()', async () => {
    const service = new PiAgentService();
    service.app = {
      get() {
        return null;
      },
      service() {
        return {};
      },
    };
    const bindExtensions = vi.fn().mockResolvedValue(undefined);
    createAgentSession.mockResolvedValue({ session: { sessionId: 'pi-sess-9', bindExtensions } });
    const persistPiSessionId = vi.fn();
    const piSession = await service.createOrResumePiSession(
      { id: 1, user_id: 2, session_path: 'sessions/wt' },
      { agentOptions: { cwd: '/tmp' }, persistPiSessionId }
    );
    expect(createAgentSession).toHaveBeenCalledTimes(1);
    expect(bindExtensions).toHaveBeenCalledTimes(1);
    expect(piSession.sessionId).toBe('pi-sess-9');
    expect(persistPiSessionId).toHaveBeenCalledWith('pi-sess-9');
  });
});

describe('readPiUserMcpConfig', () => {
  it('returns no servers when the file is missing or the agent dir is unset', () => {
    expect(readPiUserMcpConfig(undefined)).toEqual({ servers: [], errors: [] });
    expect(readPiUserMcpConfig('/nonexistent/baguette-pi-mcp-agent-dir')).toEqual({
      servers: [],
      errors: [],
    });
  });

  it('round-trips servers written by writePiUserMcpConfig and reports malformed files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baguette-pi-mcp-'));
    const { writePiUserMcpConfig } = await import('../../../services/user-mcp-runtime.js');
    await writePiUserMcpConfig(dir, {
      docs: { type: 'http', url: 'https://mcp.example/mcp' },
    });
    expect(readPiUserMcpConfig(dir)).toEqual({
      servers: [
        {
          name: 'docs',
          config: { type: 'http', url: 'https://mcp.example/mcp', exposure: 'direct' },
          source: path.join(dir, 'mcp.json'),
          scope: 'global',
        },
      ],
      errors: [],
    });

    await fs.writeFile(path.join(dir, 'mcp.json'), '{ not json', { mode: 0o600 });
    const broken = readPiUserMcpConfig(dir);
    expect(broken.servers).toEqual([]);
    expect(broken.errors[0]).toContain('mcp.json');

    await fs.writeFile(
      path.join(dir, 'mcp.json'),
      JSON.stringify({ mcpServers: { docs: 'nope' } }),
      { mode: 0o600 }
    );
    const badEntry = readPiUserMcpConfig(dir);
    expect(badEntry.servers).toEqual([]);
    expect(badEntry.errors[0]).toContain('server "docs" must be an object');
  });
});
