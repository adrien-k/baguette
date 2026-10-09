import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';

vi.mock('../anthropic-models.js', () => ({
  listModels: vi.fn().mockResolvedValue([{ id: 'sonnet', display_name: 'Sonnet' }]),
}));
const listCursorModels = vi.fn().mockResolvedValue([]);
vi.mock('../cursor-models.js', () => ({
  listCursorModels: (...args) => listCursorModels(...args),
}));

import { buildBaguetteAccountToolList } from '../baguette-account-mcp-tools.js';
import { resolveCreateSessionBaseBranch } from '../mcp/tools/create-session.js';

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

describe('CreateSession MCP agent_config_id', () => {
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

    createSpy = vi.fn().mockResolvedValue({ id: 42, short_id: 'abc12345' });
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

  it('uses last session agent_config_id when omitted', async () => {
    await db('sessions').insert({
      user_id: user.id,
      repo_full_name: 'acme/repo',
      base_branch: 'main',
      initial_prompt: 'prior',
      agent_sdk: 'claude',
      agent_config_id: claudeConfigId,
    });

    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent_config_id: claudeConfigId }),
      expect.any(Object)
    );
  });

  it('requires agent_config_id when no prior session exists', async () => {
    await db('agent_configs').delete();
    const prevVitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
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
      expect(String(result?.error ?? result?.message ?? '')).toMatch(/agent_config_id/i);
    } finally {
      if (prevVitest !== undefined) process.env.VITEST = prevVitest;
    }
  });

  it('keeps explicit agent_config_id and model', async () => {
    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
      agent_config_id: claudeConfigId,
      model: 'sonnet',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent_config_id: claudeConfigId }),
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
