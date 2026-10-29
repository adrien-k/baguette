import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';

vi.mock('../anthropic-models.js', () => ({
  listModels: vi.fn().mockResolvedValue({
    models: [{ id: 'sonnet', display_name: 'Sonnet' }],
    rejected_models: [],
  }),
}));
const listCursorModels = vi.fn().mockResolvedValue([]);
vi.mock('../cursor-models.js', () => ({
  listCursorModels: (...args) => listCursorModels(...args),
}));

import { buildBaguetteAccountToolList } from '../baguette-account-mcp-tools.js';
import {
  createCreateSessionTool,
  resolveCreateSessionBaseBranch,
} from '../mcp/tools/create-session.js';
import { createAccountContext } from '../mcp/lib/account-context.js';

const db = createTestDb();

describe('resolveCreateSessionBaseBranch', () => {
  it('accepts branch alone', () => {
    expect(resolveCreateSessionBaseBranch(undefined, 'feature/parent')).toEqual({
      base_branch: 'feature/parent',
    });
  });

  it('rejects conflicting base_branch and branch', () => {
    expect(resolveCreateSessionBaseBranch('main', 'feature/parent').error).toMatch(/must match/);
  });
});

function parseMcpToolResult(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text === 'string') {
    try {
      return JSON.parse(text);
    } catch {
      return result;
    }
  }
  return result;
}

describe('CreateSession MCP model defaults', () => {
  let app;
  let user;
  let claudeConfigId;
  let createSpy;

  beforeEach(async () => {
    listCursorModels.mockResolvedValue([]);
    await db('users').insert({
      github_id: 99,
      username: 'mcp-user',
      approved: true,
    });
    user = await db('users').where({ username: 'mcp-user' }).first();
    claudeConfigId = await insertTestAgentConfig(db, user.id, { apiKey: 'sk-ant-test' });

    createSpy = vi.fn().mockResolvedValue({ id: 42 });
    app = {
      get: () => db,
      service: (name) => {
        if (name === 'users') {
          return {
            get: async (id) => db('users').where({ id }).first(),
          };
        }
        if (name === 'repos') {
          return {
            find: async () => ({
              data: [{ id: 1, full_name: 'acme/repo', default_branch: 'main' }],
            }),
          };
        }
        if (name === 'sessions') {
          return { create: createSpy };
        }
        if (name === 'agent-configs') {
          return {
            getSdkMeta: (sdk) =>
              sdk === 'claude' ? { key: 'claude', servicePath: 'claude-agent' } : null,
            servicePathForSdk: () => 'claude-agent',
          };
        }
        throw new Error(`unexpected service ${name}`);
      },
    };

    await db('repos').insert({
      id: 1,
      full_name: 'acme/repo',
      stripped_name: 'acme-repo',
      repo_path: '/tmp/acme-repo.git',
      default_branch: 'main',
    });
    await db('user_repos').insert({ user_id: user.id, repo_id: 1 });
  });

  it('uses stored user agent_default_config_id when omitted', async () => {
    await db('users')
      .where({ id: user.id })
      .update({
        agent_default_config_id: claudeConfigId,
        agent_default_model: JSON.stringify({ model: 'sonnet', model_params: null }),
      });

    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent_config_id: claudeConfigId, model: 'sonnet' }),
      expect.any(Object)
    );
  });

  it('does not fall back to last session when user defaults are unset', async () => {
    await insertTestSession(db, {
      user_id: user.id,
      repo_full_name: 'acme/repo',
      base_branch: 'main',
      initial_prompt: 'prior',
      agent_sdk: 'claude',
      agent_config_id: claudeConfigId,
    });

    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    const result = parseMcpToolResult(
      await createSession.handler({
        repo_id: 1,
        base_branch: 'main',
        initial_prompt: 'hello',
      })
    );
    expect(result?.ok).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('requires session defaults or preset_model_id when none configured', async () => {
    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    const result = parseMcpToolResult(
      await createSession.handler({
        repo_id: 1,
        base_branch: 'main',
        initial_prompt: 'hello',
      })
    );
    expect(result?.ok).toBe(false);
    expect(String(result?.error ?? result?.message ?? '')).toMatch(/Session defaults/i);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('uses preset_model_id when provided', async () => {
    const [presetId] = await db('agent_model_presets').insert({
      user_id: user.id,
      description: 'Test preset',
      agent_config_id: claudeConfigId,
      model: 'sonnet',
    });

    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
      preset_model_id: presetId,
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent_config_id: claudeConfigId, model: 'sonnet' }),
      expect.any(Object)
    );
  });

  it('maps branch to base_branch for stacked follow-up sessions', async () => {
    await db('users')
      .where({ id: user.id })
      .update({
        agent_default_config_id: claudeConfigId,
        agent_default_model: JSON.stringify({ model: 'sonnet', model_params: null }),
      });

    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      branch: 'feature/parent',
      initial_prompt: 'follow-up',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        base_branch: 'feature/parent',
        create_new_branch: true,
      }),
      expect.any(Object)
    );
  });
});

describe('CreateSession used by the Slack bot and by sessions living in Slack threads', () => {
  let app;
  let user;
  let configId;
  let createSpy;
  let slackBot;

  beforeEach(async () => {
    await db('users').insert({ github_id: 77, username: 'slack-user', approved: true });
    user = await db('users').where({ username: 'slack-user' }).first();
    configId = await insertTestAgentConfig(db, user.id, { apiKey: 'sk-ant-test' });
    await db('repos').insert({
      id: 1,
      full_name: 'acme/repo',
      stripped_name: 'acme-repo',
      repo_path: '/tmp/acme-repo.git',
      default_branch: 'main',
    });
    await db('user_repos').insert({ user_id: user.id, repo_id: 1 });

    createSpy = vi.fn().mockResolvedValue({ id: 42 });
    slackBot = { attachSessionToThread: vi.fn().mockResolvedValue(undefined) };
    app = {
      get: (key) => (key === 'slackBot' ? slackBot : db),
      service: (name) => {
        if (name === 'users') return { get: async (id) => db('users').where({ id }).first() };
        if (name === 'repos') {
          return {
            find: async () => ({
              data: [{ id: 1, full_name: 'acme/repo', default_branch: 'main' }],
            }),
          };
        }
        if (name === 'sessions') return { create: createSpy };
        if (name === 'agent-configs') {
          return { getSdkMeta: (sdk) => (sdk === 'claude' ? { key: 'claude' } : null) };
        }
        throw new Error(`unexpected service ${name}`);
      },
    };
  });

  const tool = (extra = {}, callerSession = null) =>
    createCreateSessionTool({
      ...createAccountContext({ id: user.id }, app, { callerSession }),
      ...extra,
    });
  const args = { repo_id: 1, base_branch: 'main', initial_prompt: 'hello' };

  it('uses the model a caller chose even when the user has no defaults configured', async () => {
    const resolveBuilderModel = vi
      .fn()
      .mockResolvedValue({ agent_config_id: configId, model: 'haiku', model_params: null });
    const result = parseMcpToolResult(await tool({ resolveBuilderModel }).handler(args));

    expect(result.ok).toBe(true);
    expect(resolveBuilderModel).toHaveBeenCalledWith(
      db,
      user.id,
      expect.objectContaining({ repo_id: 1 })
    );
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent_config_id: configId, model: 'haiku', agent_sdk: 'claude' }),
      expect.any(Object)
    );
  });

  it('passes a title and a first-message tag to the new session, when the caller has them', async () => {
    const resolveBuilderModel = vi
      .fn()
      .mockResolvedValue({ agent_config_id: configId, model: 'haiku', model_params: null });
    const initialMessageMeta = { source: 'slack', slack: { user_id: 'U1' } };
    await tool({ resolveBuilderModel, initialLabel: 'Fix login', initialMessageMeta }).handler({
      ...args,
      branch_name: 'fix-login',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ branch_name: 'fix-login' }),
      expect.objectContaining({ initialLabel: 'Fix login', initialMessageMeta })
    );
  });

  it('leaves those params out for ordinary callers', async () => {
    const resolveBuilderModel = vi
      .fn()
      .mockResolvedValue({ agent_config_id: configId, model: 'haiku', model_params: null });
    await tool({ resolveBuilderModel }).handler(args);
    const sessionParams = createSpy.mock.calls[0][1];
    expect(sessionParams).not.toHaveProperty('initialLabel');
    expect(sessionParams).not.toHaveProperty('initialMessageMeta');
  });

  it('reports a failing model resolver as a tool error', async () => {
    const resolveBuilderModel = vi.fn().mockRejectedValue(new Error('no models'));
    const result = parseMcpToolResult(await tool({ resolveBuilderModel }).handler(args));
    expect(result).toMatchObject({ ok: false, error: 'no models' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('moves the Slack thread of the calling session over to the new session', async () => {
    const resolveBuilderModel = vi
      .fn()
      .mockResolvedValue({ agent_config_id: configId, model: 'haiku', model_params: null });
    await tool({ resolveBuilderModel }, { id: 7 }).handler(args);
    expect(slackBot.attachSessionToThread).toHaveBeenCalledWith(7, 42);
  });

  it('does not touch Slack when the caller is not a session', async () => {
    const resolveBuilderModel = vi
      .fn()
      .mockResolvedValue({ agent_config_id: configId, model: 'haiku', model_params: null });
    await tool({ resolveBuilderModel }).handler(args);
    expect(slackBot.attachSessionToThread).not.toHaveBeenCalled();
  });

  it('still creates the session when the Slack hand-over fails or Slack is not there', async () => {
    const resolveBuilderModel = vi
      .fn()
      .mockResolvedValue({ agent_config_id: configId, model: 'haiku', model_params: null });
    slackBot.attachSessionToThread.mockRejectedValue(new Error('db locked'));
    expect(
      parseMcpToolResult(await tool({ resolveBuilderModel }, { id: 7 }).handler(args)).ok
    ).toBe(true);

    const noBot = { ...app, get: (key) => (key === 'slackBot' ? undefined : db) };
    const bare = createCreateSessionTool({
      ...createAccountContext({ id: user.id }, noBot, { callerSession: { id: 7 } }),
      resolveBuilderModel,
    });
    expect(parseMcpToolResult(await bare.handler(args)).ok).toBe(true);
  });
});
