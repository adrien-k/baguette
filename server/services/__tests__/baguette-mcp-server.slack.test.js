/**
 * Tests for the Slack tool exposed through the baguette MCP server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  const tool = (name, description, inputSchema, handler) => ({
    name,
    description,
    inputSchema,
    handler,
  });
  const createSdkMcpServer = vi.fn((opts) => ({ name: opts.name, tools: opts.tools }));
  return { tool, createSdkMcpServer };
});

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb(null, { stdout: '', stderr: '' })),
}));

vi.mock('../github.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getOpenPR: vi.fn().mockResolvedValue(null) };
});

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadBaguetteConfig: vi.fn().mockResolvedValue(null) };
});

vi.mock('../agent-settings.js', () => ({ getGithubToken: vi.fn(() => 'ghtoken') }));
vi.mock('../logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, PUBLIC_HOST: 'https://baguette.test' };
});
vi.mock('../../prompts/loadPrompt.js', () => ({
  default: vi.fn().mockResolvedValue('prompt text'),
}));
vi.mock('../port-utils.js', () => ({ isPortListening: vi.fn().mockResolvedValue(false) }));

vi.mock('../slack.js', () => ({
  postMessage: vi.fn(),
  getPermalink: vi.fn(),
  resolveChannelId: vi.fn(),
}));

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { getPermalink, postMessage, resolveChannelId } from '../slack.js';
import { buildBaguetteMcpServer } from '../baguette-mcp-server.js';

// ─── Harness ────────────────────────────────────────────────────────────────

const SESSION = {
  id: 1,
  short_id: 'abc123',
  user_id: 7,
  repo_id: 3,
  repo_full_name: 'owner/repo',
  base_branch: 'main',
  worktree_path: '/tmp/wt',
  agent_sdk: 'claude',
  model: 'claude-opus-5',
  auto_push: 1,
};

const ACME = { id: 1, name: 'acme', bot_token: 'xoxb-token' };
const ENG = { id: 2, name: 'eng', bot_token: 'xoxb-eng' };

async function buildTools({ slackApps = [ACME] } = {}) {
  const db = (table) => {
    if (table === 'sessions') return { where: () => ({ first: async () => ({ ...SESSION }) }) };
    return { where: () => ({ first: async () => null }) };
  };
  const app = {
    get: (key) => (key === 'db' ? db : null),
    service: (name) => {
      if (name === 'admin/slack') return { find: async () => slackApps };
      return { patch: vi.fn(), get: async () => ({ id: 7, access_token: 'tok' }) };
    },
  };
  await buildBaguetteMcpServer({ ...SESSION }, app);
  return createSdkMcpServer.mock.calls.at(-1)[0].tools;
}

const call = (tools, name, args = {}) => {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool '${name}' not found`);
  return t.handler(args, null);
};

const parse = (res) => JSON.parse(res.content[0].text);

beforeEach(() => {
  vi.clearAllMocks();
  postMessage.mockResolvedValue({ channel: 'C_ENG', ts: '111.2' });
  getPermalink.mockResolvedValue('https://slack.test/p111');
  resolveChannelId.mockImplementation(async (_token, channel) =>
    channel === '#eng' ? 'C_ENG' : channel
  );
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('tool registration', () => {
  it('hides SlackPostMessage when no Slack app is configured', async () => {
    const names = (await buildTools({ slackApps: [] })).map((t) => t.name);
    expect(names).not.toContain('SlackPostMessage');
    expect(names).toContain('PrUpsert');
  });

  it('exposes SlackPostMessage once an app is configured', async () => {
    expect((await buildTools()).map((t) => t.name)).toContain('SlackPostMessage');
  });
});

describe('SlackPostMessage', () => {
  it('posts to the given channel and returns ts and permalink', async () => {
    const tools = await buildTools();
    const result = parse(
      await call(tools, 'SlackPostMessage', { text: 'Build is green', channel: 'C_ENG' })
    );

    expect(result).toMatchObject({
      ok: true,
      channel: 'C_ENG',
      ts: '111.2',
      app: 'acme',
    });
    expect(result.permalink).toBe('https://slack.test/p111');
    expect(postMessage).toHaveBeenCalledWith(
      'xoxb-token',
      expect.objectContaining({ channel: 'C_ENG' })
    );
  });

  it('attributes the message to the session that posted it', async () => {
    const tools = await buildTools();
    await call(tools, 'SlackPostMessage', { text: 'Build is green', channel: 'C_ENG' });

    const { text } = postMessage.mock.calls[0][1];
    expect(text).toContain('Build is green');
    expect(text).toContain('https://baguette.test/sessions/1');
    expect(text).toContain('Claude claude-opus-5');
    expect(text).toContain('session abc123');
  });

  it('resolves a channel name to an id', async () => {
    const tools = await buildTools();
    await call(tools, 'SlackPostMessage', { text: 'hi', channel: '#eng' });

    expect(resolveChannelId).toHaveBeenCalledWith('xoxb-token', '#eng');
    expect(postMessage.mock.calls[0][1].channel).toBe('C_ENG');
  });

  it('uses the named app when several are configured', async () => {
    const tools = await buildTools({ slackApps: [ACME, ENG] });
    await call(tools, 'SlackPostMessage', { text: 'hi', channel: 'C_ENG', app: 'eng' });

    expect(postMessage).toHaveBeenCalledWith('xoxb-eng', expect.anything());
  });

  it('requires app when more than one is configured', async () => {
    const tools = await buildTools({ slackApps: [ACME, ENG] });
    const result = parse(await call(tools, 'SlackPostMessage', { text: 'hi', channel: 'C_ENG' }));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/multiple slack apps/i);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('reports a Slack API failure instead of throwing', async () => {
    postMessage.mockRejectedValue(new Error('Slack chat.postMessage failed: not_in_channel'));
    const tools = await buildTools();
    const result = parse(await call(tools, 'SlackPostMessage', { text: 'hi', channel: 'C_ENG' }));

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/not_in_channel/);
  });

  it('still succeeds when the permalink lookup fails', async () => {
    getPermalink.mockRejectedValue(new Error('missing_scope'));
    const tools = await buildTools();
    const result = parse(await call(tools, 'SlackPostMessage', { text: 'hi', channel: 'C_ENG' }));

    expect(result.ok).toBe(true);
    expect(result.permalink).toBeNull();
  });

  it('fails when apps were removed mid-session', async () => {
    let slackApps = [ACME];
    const db = (table) => {
      if (table === 'sessions') return { where: () => ({ first: async () => ({ ...SESSION }) }) };
      return { where: () => ({ first: async () => null }) };
    };
    const app = {
      get: (key) => (key === 'db' ? db : null),
      service: (name) => {
        if (name === 'admin/slack') return { find: async () => slackApps };
        return { patch: vi.fn(), get: async () => ({ id: 7, access_token: 'tok' }) };
      },
    };
    await buildBaguetteMcpServer({ ...SESSION }, app);
    const tools = createSdkMcpServer.mock.calls.at(-1)[0].tools;
    slackApps = [];

    const result = parse(await call(tools, 'SlackPostMessage', { text: 'hi', channel: 'C_ENG' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });
});
