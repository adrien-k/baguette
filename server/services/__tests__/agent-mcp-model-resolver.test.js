import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { ensureTestMockConfig } from '../../test-utils/agent-configs.js';
import {
  MCP_AGENT_CREATED_ANY_REQUIRED_ERROR,
  MCP_AGENT_CREATED_MODEL_NOT_ALLOWED_ERROR,
  MCP_BUILDER_MODEL_SETTINGS_ERROR,
  MCP_REVIEWER_MODEL_SETTINGS_ERROR,
  MCP_SUBAGENT_PRESET_REQUIRED_ERROR,
  resolveMcpBuilderModel,
  resolveMcpReviewerModel,
  resolveMcpStartSubagentModel,
} from '../agent-mcp-model-resolver.js';
import {
  SUBAGENT_DEFAULT_ANY,
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_PRESET,
} from '../../../shared/subagent-default-mode.js';
import { insertTestSession } from '../../test-utils/db.js';
import { stringifyAgentDefaultModel } from '../../../shared/agent-default-model.js';
import { MOCK_SECONDARY_MODEL_ID, MOCK_STANDARD_MODEL_ID } from '../../../shared/mock-agent-sdk.js';

const db = createTestDb();

/** Stub app so resolveExplicitModel can validate raw models against the config's model list. */
function makeValidatingApp() {
  return {
    get: () => db,
    service: (name) => {
      if (name === 'users') {
        return { get: async (id) => db('users').where({ id }).first() };
      }
      if (name === 'agent-configs') {
        return {
          getSdkMeta: (sdk) => ({ key: sdk, servicePath: `${sdk}-agent` }),
        };
      }
      throw new Error(`unexpected service ${name}`);
    },
  };
}

describe('resolveMcpBuilderModel', () => {
  let userId;
  let configId;
  let repoId;
  let app;

  beforeEach(async () => {
    vi.stubEnv('ENABLE_MOCK_AGENT', 'true');
    app = makeValidatingApp();
    await db('users').insert({ github_id: 99, username: 'mcp-model', status: 'approved' });
    userId = (await db('users').where({ username: 'mcp-model' }).first()).id;
    configId = await ensureTestMockConfig(db, userId);
    await db('repos').insert({ full_name: 'org/r', repo_path: '/tmp/r' });
    repoId = (await db('repos').where({ full_name: 'org/r' }).first()).id;
    await db('user_repos').insert({ user_id: userId, repo_id: repoId });
  });

  it('resolves a preset model by id', async () => {
    const [presetId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Todos',
      agent_config_id: configId,
      model: 'mock-standard',
    });
    const resolved = await resolveMcpBuilderModel(db, userId, { preset_model_id: presetId });
    expect(resolved.agent_config_id).toBe(configId);
    expect(resolved.agent_sdk).toBe('mock');
    expect(resolved.model).toBe('mock-standard');
  });

  it('rejects a preset that is turned off', async () => {
    const [presetId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Off',
      agent_config_id: configId,
      model: 'mock-standard',
      enabled: 0,
    });
    await expect(resolveMcpBuilderModel(db, userId, { preset_model_id: presetId })).rejects.toThrow(
      /is turned off in Settings/
    );
  });

  it('rejects a preset that is not enabled for new sessions', async () => {
    const [presetId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Subagents only',
      agent_config_id: configId,
      model: 'mock-standard',
      for_new_sessions: 0,
    });
    await expect(resolveMcpBuilderModel(db, userId, { preset_model_id: presetId })).rejects.toThrow(
      /not enabled for new sessions/
    );
  });

  it('uses account session defaults when preset is omitted', async () => {
    await db('users')
      .where({ id: userId })
      .update({
        agent_default_config_id: configId,
        agent_default_model: stringifyAgentDefaultModel({
          model: 'mock-standard',
          model_params: null,
        }),
      });
    const resolved = await resolveMcpBuilderModel(db, userId, {});
    expect(resolved.model).toBe('mock-standard');
  });

  it('fails when no preset and no explicit default', async () => {
    await expect(resolveMcpBuilderModel(db, userId, {})).rejects.toThrow(
      MCP_BUILDER_MODEL_SETTINGS_ERROR
    );
  });

  it('uses the fixed model instead of the builder default when the policy is config', async () => {
    await db('users')
      .where({ id: userId })
      .update({
        agent_default_config_id: configId,
        agent_default_model: stringifyAgentDefaultModel({
          model: MOCK_STANDARD_MODEL_ID,
          model_params: null,
        }),
        subagent_default_mode: SUBAGENT_DEFAULT_CONFIG,
        subagent_default_config_id: configId,
        subagent_default_model: stringifyAgentDefaultModel({
          model: MOCK_SECONDARY_MODEL_ID,
          model_params: null,
        }),
      });
    const resolved = await resolveMcpBuilderModel(db, userId, {});
    expect(resolved.model).toBe(MOCK_SECONDARY_MODEL_ID);
  });

  it('requires a preset for new sessions when the policy is preset', async () => {
    await db('users')
      .where({ id: userId })
      .update({ subagent_default_mode: SUBAGENT_DEFAULT_PRESET });
    await expect(resolveMcpBuilderModel(db, userId, {})).rejects.toThrow(
      MCP_SUBAGENT_PRESET_REQUIRED_ERROR
    );
  });

  it('resolves a raw model for new sessions when the policy is any', async () => {
    await db('users').where({ id: userId }).update({ subagent_default_mode: SUBAGENT_DEFAULT_ANY });
    const resolved = await resolveMcpBuilderModel(db, userId, {
      agent_config_id: configId,
      model: MOCK_SECONDARY_MODEL_ID,
      app,
    });
    expect(resolved.agent_config_id).toBe(configId);
    expect(resolved.model).toBe(MOCK_SECONDARY_MODEL_ID);
  }, 15000);

  it('rejects a raw model for new sessions unless the policy is any', async () => {
    await expect(
      resolveMcpBuilderModel(db, userId, {
        agent_config_id: configId,
        model: MOCK_SECONDARY_MODEL_ID,
        app,
      })
    ).rejects.toThrow(MCP_AGENT_CREATED_MODEL_NOT_ALLOWED_ERROR);
  });

  it('rejects raw model resolution without app instead of skipping validation', async () => {
    await db('users').where({ id: userId }).update({ subagent_default_mode: SUBAGENT_DEFAULT_ANY });
    await expect(
      resolveMcpBuilderModel(db, userId, {
        agent_config_id: configId,
        model: MOCK_SECONDARY_MODEL_ID,
      })
    ).rejects.toThrow(/requires app/);
  });

  it('validates a raw model against the configuration model list for new sessions', async () => {
    await db('users').where({ id: userId }).update({ subagent_default_mode: SUBAGENT_DEFAULT_ANY });
    await expect(
      resolveMcpBuilderModel(db, userId, {
        agent_config_id: configId,
        model: 'not-a-model',
        app,
      })
    ).rejects.toThrow(/Unknown mock model/);
  }, 15000);
});

describe('resolveMcpStartSubagentModel', () => {
  let userId;
  let configId;
  let sessionId;
  let app;

  beforeEach(async () => {
    vi.stubEnv('ENABLE_MOCK_AGENT', 'true');
    app = makeValidatingApp();
    await db('users').insert({ github_id: 100, username: 'mcp-sub', status: 'approved' });
    userId = (await db('users').where({ username: 'mcp-sub' }).first()).id;
    configId = await ensureTestMockConfig(db, userId);
    await db('repos').insert({ full_name: 'org/sub', repo_path: '/tmp/sub' });
    const repoId = (await db('repos').where({ full_name: 'org/sub' }).first()).id;
    sessionId = await insertTestSession(db, {
      user_id: userId,
      repo_id: repoId,
      repo_full_name: 'org/sub',
      base_branch: 'main',
      short_id: 'sub01',
      initial_prompt: 'hi',
      status: 'stopped',
      agent_config_id: configId,
      agent_sdk: 'mock',
      model: MOCK_STANDARD_MODEL_ID,
      session_path: 'worktrees/sub-test',
    });
  });

  it('inherits the session primary builder by default', async () => {
    const resolved = await resolveMcpStartSubagentModel(db, userId, { session_id: sessionId });
    expect(resolved.model).toBe(MOCK_STANDARD_MODEL_ID);
  });

  it('uses explicit subagent config mode', async () => {
    await db('users')
      .where({ id: userId })
      .update({
        subagent_default_mode: SUBAGENT_DEFAULT_CONFIG,
        subagent_default_config_id: configId,
        subagent_default_model: stringifyAgentDefaultModel({
          model: MOCK_SECONDARY_MODEL_ID,
          model_params: null,
        }),
      });
    const resolved = await resolveMcpStartSubagentModel(db, userId, { session_id: sessionId });
    expect(resolved.model).toBe(MOCK_SECONDARY_MODEL_ID);
  });

  it('requires preset_model_id when subagent default is preset', async () => {
    await db('users')
      .where({ id: userId })
      .update({ subagent_default_mode: SUBAGENT_DEFAULT_PRESET });
    await expect(
      resolveMcpStartSubagentModel(db, userId, { session_id: sessionId })
    ).rejects.toThrow(MCP_SUBAGENT_PRESET_REQUIRED_ERROR);
  });

  it('applies preset_model_id when subagent default is inherit', async () => {
    const [presetId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Alt',
      agent_config_id: configId,
      model: MOCK_SECONDARY_MODEL_ID,
    });
    const resolved = await resolveMcpStartSubagentModel(db, userId, {
      session_id: sessionId,
      preset_model_id: presetId,
    });
    expect(resolved.agent_config_id).toBe(configId);
    expect(resolved.model).toBe(MOCK_SECONDARY_MODEL_ID);
  });

  it('accepts a preset enabled only for subagents', async () => {
    const [presetId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Subagents only',
      agent_config_id: configId,
      model: MOCK_SECONDARY_MODEL_ID,
      for_new_sessions: 0,
    });
    const resolved = await resolveMcpStartSubagentModel(db, userId, {
      session_id: sessionId,
      preset_model_id: presetId,
    });
    expect(resolved.model).toBe(MOCK_SECONDARY_MODEL_ID);
  });

  it('rejects a preset that is turned off or not enabled for subagents', async () => {
    const [offId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Off',
      agent_config_id: configId,
      model: MOCK_SECONDARY_MODEL_ID,
      enabled: 0,
    });
    await expect(
      resolveMcpStartSubagentModel(db, userId, { session_id: sessionId, preset_model_id: offId })
    ).rejects.toThrow(/is turned off in Settings/);

    const [noSubId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Sessions only',
      agent_config_id: configId,
      model: MOCK_SECONDARY_MODEL_ID,
      for_subagents: 0,
    });
    await expect(
      resolveMcpStartSubagentModel(db, userId, { session_id: sessionId, preset_model_id: noSubId })
    ).rejects.toThrow(/not enabled for subagents/);
  });

  it('applies preset_model_id when subagent default is config', async () => {
    await db('users')
      .where({ id: userId })
      .update({
        subagent_default_mode: SUBAGENT_DEFAULT_CONFIG,
        subagent_default_config_id: configId,
        subagent_default_model: stringifyAgentDefaultModel({
          model: MOCK_STANDARD_MODEL_ID,
          model_params: null,
        }),
      });
    const [presetId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Alt',
      agent_config_id: configId,
      model: MOCK_SECONDARY_MODEL_ID,
    });
    const resolved = await resolveMcpStartSubagentModel(db, userId, {
      session_id: sessionId,
      preset_model_id: presetId,
    });
    expect(resolved.model).toBe(MOCK_SECONDARY_MODEL_ID);
  });

  it('requires a preset or a raw model when the policy is any', async () => {
    await db('users').where({ id: userId }).update({ subagent_default_mode: SUBAGENT_DEFAULT_ANY });
    await expect(
      resolveMcpStartSubagentModel(db, userId, { session_id: sessionId })
    ).rejects.toThrow(MCP_AGENT_CREATED_ANY_REQUIRED_ERROR);
  });

  it('resolves a raw model when the policy is any', async () => {
    await db('users').where({ id: userId }).update({ subagent_default_mode: SUBAGENT_DEFAULT_ANY });
    const resolved = await resolveMcpStartSubagentModel(db, userId, {
      session_id: sessionId,
      agent_config_id: configId,
      model: MOCK_SECONDARY_MODEL_ID,
      app,
    });
    expect(resolved.model).toBe(MOCK_SECONDARY_MODEL_ID);
  }, 15000);

  it('rejects raw model resolution without app instead of skipping validation', async () => {
    await db('users').where({ id: userId }).update({ subagent_default_mode: SUBAGENT_DEFAULT_ANY });
    await expect(
      resolveMcpStartSubagentModel(db, userId, {
        session_id: sessionId,
        agent_config_id: configId,
        model: MOCK_SECONDARY_MODEL_ID,
      })
    ).rejects.toThrow(/requires app/);
  });

  it('rejects passing both a preset and a raw model', async () => {
    await db('users').where({ id: userId }).update({ subagent_default_mode: SUBAGENT_DEFAULT_ANY });
    const [presetId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Alt',
      agent_config_id: configId,
      model: MOCK_STANDARD_MODEL_ID,
    });
    await expect(
      resolveMcpStartSubagentModel(db, userId, {
        session_id: sessionId,
        preset_model_id: presetId,
        agent_config_id: configId,
        model: MOCK_SECONDARY_MODEL_ID,
      })
    ).rejects.toThrow(/not both/);
  });
});

describe('resolveMcpReviewerModel', () => {
  let userId;
  let configId;

  beforeEach(async () => {
    await db('users').insert({ github_id: 77, username: 'reviewer-mcp', status: 'approved' });
    const user = await db('users').where({ username: 'reviewer-mcp' }).first();
    userId = user.id;
    configId = await ensureTestMockConfig(db, userId);
  });

  it('returns account reviewer defaults', async () => {
    await db('users')
      .where({ id: userId })
      .update({
        reviewer_default_config_id: configId,
        reviewer_default_model: JSON.stringify({
          model: MOCK_STANDARD_MODEL_ID,
          model_params: null,
        }),
      });
    const resolved = await resolveMcpReviewerModel(db, userId);
    expect(resolved).toMatchObject({
      agent_config_id: configId,
      model: MOCK_STANDARD_MODEL_ID,
    });
  });

  it('throws when reviewer defaults are missing', async () => {
    await expect(resolveMcpReviewerModel(db, userId)).rejects.toThrow(
      MCP_REVIEWER_MODEL_SETTINGS_ERROR
    );
  });
});
