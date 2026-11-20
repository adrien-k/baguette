import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';

vi.mock('../../agent-sdks/claude/anthropic-models.js', () => ({
  listModels: vi.fn().mockResolvedValue({
    models: [{ id: 'sonnet', display_name: 'Sonnet' }],
    rejected_models: [],
  }),
}));
const listCursorModels = vi.fn().mockResolvedValue([]);
vi.mock('../../agent-sdks/cursor/models.js', () => ({
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
      status: 'approved',
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

  it('does not send auto_load_skills so sessions.create can apply user defaults', async () => {
    await db('users')
      .where({ id: user.id })
      .update({
        agent_default_config_id: claudeConfigId,
        agent_default_model: JSON.stringify({ model: 'sonnet', model_params: null }),
        default_auto_load_skills: JSON.stringify(['MCP default skill']),
      });

    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
    });
    const payload = createSpy.mock.calls[0][0];
    expect(payload).not.toHaveProperty('auto_load_skills');
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
    expect(String(result?.error ?? result?.message ?? '')).toMatch(/Builder default/i);
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

  it('uses a listed model when agent-created policy is any', async () => {
    await db('users').where({ id: user.id }).update({ subagent_default_mode: 'any' });
    const tools = buildBaguetteAccountToolList({ id: user.id, subagent_default_mode: 'any' }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    expect(createSession.schema.model).toBeDefined();
    expect(createSession.schema.agent_config_id).toBeDefined();
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
      agent_config_id: claudeConfigId,
      model: 'sonnet',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent_config_id: claudeConfigId, model: 'sonnet' }),
      expect.any(Object)
    );
  });

  it('rejects an unknown model when agent-created policy is any', async () => {
    await db('users').where({ id: user.id }).update({ subagent_default_mode: 'any' });
    const tools = buildBaguetteAccountToolList({ id: user.id, subagent_default_mode: 'any' }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    const result = parseMcpToolResult(
      await createSession.handler({
        repo_id: 1,
        base_branch: 'main',
        initial_prompt: 'hello',
        agent_config_id: claudeConfigId,
        model: 'not-a-model',
      })
    );
    expect(result?.ok).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('uses the fixed model for new sessions when the policy is config', async () => {
    await db('users')
      .where({ id: user.id })
      .update({
        subagent_default_mode: 'config',
        subagent_default_config_id: claudeConfigId,
        subagent_default_model: JSON.stringify({ model: 'haiku', model_params: null }),
        agent_default_config_id: claudeConfigId,
        agent_default_model: JSON.stringify({ model: 'sonnet', model_params: null }),
      });
    const tools = buildBaguetteAccountToolList(
      { id: user.id, subagent_default_mode: 'config' },
      app
    );
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent_config_id: claudeConfigId, model: 'haiku' }),
      expect.any(Object)
    );
  });

  it('rejects notify_parent from a repo session before creating', async () => {
    const tools = buildBaguetteAccountToolList({ id: user.id }, app, {
      callerSession: { id: 7, is_global: false },
      callerAgent: { id: 3 },
    });
    const createSession = tools.find((t) => t.name === 'CreateSession');
    const result = parseMcpToolResult(
      await createSession.handler({
        repo_id: 1,
        base_branch: 'main',
        initial_prompt: 'hello',
        notify_parent: true,
      })
    );
    expect(result?.ok).toBe(false);
    expect(result?.error).toMatch(/Only global sessions/);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('notify_parent from a global session creates the session', async () => {
    await db('users')
      .where({ id: user.id })
      .update({
        agent_default_config_id: claudeConfigId,
        agent_default_model: JSON.stringify({ model: 'sonnet', model_params: null }),
      });
    const tools = buildBaguetteAccountToolList({ id: user.id }, app, {
      callerSession: { id: 7, is_global: true },
      callerAgent: { id: 3 },
    });
    const createSession = tools.find((t) => t.name === 'CreateSession');
    const result = parseMcpToolResult(
      await createSession.handler({
        repo_id: 1,
        base_branch: 'main',
        initial_prompt: 'hello',
        notify_parent: true,
      })
    );
    expect(result?.ok).toBe(true);
    expect(createSpy).toHaveBeenCalled();
  });
});

describe('CreateSession for Slack assistants', () => {
  let app;
  let user;
  let configId;
  let createSpy;
  let repoScope;

  beforeEach(async () => {
    await db('users').insert({ github_id: 77, username: 'slack-user', status: 'approved' });
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
    repoScope = vi.fn().mockResolvedValue(null);
    app = {
      get: () => db,
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
        if (name === 'slack-assistants') return { repoScope };
        if (name === 'agent-configs') {
          return { getSdkMeta: (sdk) => (sdk === 'claude' ? { key: 'claude' } : null) };
        }
        throw new Error(`unexpected service ${name}`);
      },
    };
  });

  const configureDefaultModel = () =>
    db('users')
      .where({ id: user.id })
      .update({
        agent_default_config_id: configId,
        agent_default_model: JSON.stringify({ model: 'haiku', model_params: null }),
      });

  const tool = (extra = {}, callerSession = null) =>
    createCreateSessionTool({
      ...createAccountContext({ id: user.id }, app, { callerSession }),
      ...extra,
    });
  const repoArgs = { repo_id: 1, base_branch: 'main', initial_prompt: 'hello' };

  it('types the new session, titles it and tags its first message, when the caller has them', async () => {
    await configureDefaultModel();
    const initialMessageMeta = { source: 'slack', slack: { user_id: 'U1' } };
    const result = parseMcpToolResult(
      await tool({ slackAppId: 3, initialLabel: 'Slack assistant', initialMessageMeta }).handler({
        is_global: true,
        initial_prompt: 'hello',
      })
    );
    expect(result.ok).toBe(true);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ is_global: true, slack_app_id: 3 }),
      expect.objectContaining({ initialLabel: 'Slack assistant', initialMessageMeta })
    );
  });

  it('leaves those out for ordinary callers', async () => {
    await configureDefaultModel();
    await tool().handler(repoArgs);
    expect(createSpy.mock.calls[0][0]).not.toHaveProperty('slack_app_id');
    const sessionParams = createSpy.mock.calls[0][1];
    expect(sessionParams).not.toHaveProperty('initialLabel');
    expect(sessionParams).not.toHaveProperty('initialMessageMeta');
  });

  it('fails with the settings instructions when no builder model is configured', async () => {
    const result = parseMcpToolResult(await tool().handler(repoArgs));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Settings/);
    expect(createSpy).not.toHaveBeenCalled();
  });

  describe('repository scope of a Slack assistant', () => {
    const assistant = { id: 7, slack_app_id: 3, is_global: 1 };

    it('refuses a repository outside the app’s scope', async () => {
      repoScope.mockResolvedValue([2]);
      const result = parseMcpToolResult(await tool({}, assistant).handler(repoArgs));
      expect(result).toMatchObject({ ok: false });
      expect(result.error).toMatch(/outside what this Slack assistant may work in/);
      expect(repoScope).toHaveBeenCalledWith(3);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('allows a repository inside the scope, or any when none is set', async () => {
      await configureDefaultModel();
      repoScope.mockResolvedValue([1]);
      expect(parseMcpToolResult(await tool({}, assistant).handler(repoArgs)).ok).toBe(true);
      repoScope.mockResolvedValue(null);
      expect(parseMcpToolResult(await tool({}, assistant).handler(repoArgs)).ok).toBe(true);
    });

    it('does not apply to other sessions', async () => {
      repoScope.mockResolvedValue([2]);
      await tool({}, { id: 8, is_global: 1 }).handler(repoArgs);
      expect(repoScope).not.toHaveBeenCalled();
    });
  });
});
