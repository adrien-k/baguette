import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { ensureTestMockConfig } from '../../test-utils/agent-configs.js';
import {
  MCP_BUILDER_MODEL_SETTINGS_ERROR,
  MCP_SUBAGENT_PRESET_REQUIRED_ERROR,
  resolveMcpBuilderModel,
  resolveMcpStartBuilderModel,
} from '../agent-mcp-model-resolver.js';
import {
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_PRESET,
} from '../../../shared/subagent-default-mode.js';
import { insertTestSession } from '../../test-utils/db.js';
import { stringifyAgentDefaultModel } from '../../../shared/agent-default-model.js';
import { MOCK_SECONDARY_MODEL_ID, MOCK_STANDARD_MODEL_ID } from '../../../shared/mock-agent-sdk.js';

const db = createTestDb();

describe('resolveMcpBuilderModel', () => {
  let userId;
  let configId;
  let repoId;

  beforeEach(async () => {
    await db('users').insert({ github_id: 99, username: 'mcp-model', approved: true });
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
});

describe('resolveMcpStartBuilderModel', () => {
  let userId;
  let configId;
  let sessionId;

  beforeEach(async () => {
    await db('users').insert({ github_id: 100, username: 'mcp-sub', approved: true });
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
    const resolved = await resolveMcpStartBuilderModel(db, userId, { session_id: sessionId });
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
    const resolved = await resolveMcpStartBuilderModel(db, userId, { session_id: sessionId });
    expect(resolved.model).toBe(MOCK_SECONDARY_MODEL_ID);
  });

  it('requires preset_model_id when subagent default is preset', async () => {
    await db('users')
      .where({ id: userId })
      .update({ subagent_default_mode: SUBAGENT_DEFAULT_PRESET });
    await expect(
      resolveMcpStartBuilderModel(db, userId, { session_id: sessionId })
    ).rejects.toThrow(MCP_SUBAGENT_PRESET_REQUIRED_ERROR);
  });

  it('ignores preset_model_id when subagent default is inherit', async () => {
    const [presetId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Alt',
      agent_config_id: configId,
      model: MOCK_SECONDARY_MODEL_ID,
    });
    const resolved = await resolveMcpStartBuilderModel(db, userId, {
      session_id: sessionId,
      preset_model_id: presetId,
    });
    expect(resolved.model).toBe(MOCK_STANDARD_MODEL_ID);
  });
});
