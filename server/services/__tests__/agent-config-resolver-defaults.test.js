import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';
import {
  resolveAgentConfigIdForRepoSdk,
  resolveEffectiveAgentDefaults,
  resolveSessionFormDefaults,
} from '../agent-config-resolver.js';
import { repoAgentConfigLabel } from '../../../shared/agent-config-labels.js';

const db = createTestDb({ beforeEach, afterEach });

describe('resolveEffectiveAgentDefaults', () => {
  let userId;
  let claudeConfigId;
  let cursorConfigId;

  beforeEach(async () => {
    await db('users').insert({ github_id: 1, username: 'defaults-user', approved: true });
    const user = await db('users').where({ username: 'defaults-user' }).first();
    userId = user.id;
    claudeConfigId = await insertTestAgentConfig(db, userId, { apiKey: 'sk-ant' });
    cursorConfigId = await insertTestAgentConfig(db, userId, {
      sdk: 'cursor',
      apiKey: 'cursor-key',
      apiKeyEnvVar: null,
    });
  });

  it('prefers stored user defaults over last session', async () => {
    await db('users')
      .where({ id: userId })
      .update({
        agent_default_config_id: cursorConfigId,
        agent_default_model: JSON.stringify({
          model: 'composer',
          model_params: [{ id: 'fast', value: 'true' }],
        }),
      });
    await db('sessions').insert({
      user_id: userId,
      repo_full_name: 'a/b',
      base_branch: 'main',
      initial_prompt: 'old',
      agent_sdk: 'claude',
      agent_config_id: claudeConfigId,
      model: 'sonnet',
    });

    const resolved = await resolveEffectiveAgentDefaults(db, userId);
    expect(resolved).toMatchObject({
      agent_config_id: cursorConfigId,
      agent_sdk: 'cursor',
      model: 'composer',
      source: 'user',
    });
    expect(resolved.model_params).toEqual([{ id: 'fast', value: 'true' }]);
  });

  it('resolveSessionFormDefaults includes reviewer fields', async () => {
    await db('users')
      .where({ id: userId })
      .update({
        reviewer_default_config_id: claudeConfigId,
        reviewer_default_model: JSON.stringify({ model: 'sonnet', model_params: null }),
      });
    const form = await resolveSessionFormDefaults(db, userId);
    expect(form.review_agent_config_id).toBe(claudeConfigId);
    expect(form.review_model).toBe('sonnet');
    expect(form.reviewer_source).toBe('user');
  });
});

describe('resolveAgentConfigIdForRepoSdk', () => {
  let userId;
  let repoId;
  let claudeA;
  let claudeB;

  beforeEach(async () => {
    await db('users').insert({ github_id: 2, username: 'resolve-user', approved: true });
    const user = await db('users').where({ username: 'resolve-user' }).first();
    userId = user.id;
    [repoId] = await db('repos').insert({
      full_name: 'org/my-repo',
      repo_path: '/tmp/my-repo',
    });
    claudeA = await insertTestAgentConfig(db, userId, {
      apiKey: 'sk-ant-a',
      label: repoAgentConfigLabel('claude', 'org/my-repo'),
    });
    claudeB = await insertTestAgentConfig(db, userId, {
      apiKey: 'sk-ant-b',
      label: repoAgentConfigLabel('claude', 'org/my-repo-2'),
    });
  });

  it('uses agent default config instead of repo-scoped label match', async () => {
    await db('users').where({ id: userId }).update({ agent_default_config_id: claudeB });
    const resolved = await resolveAgentConfigIdForRepoSdk(db, userId, repoId, 'claude');
    expect(resolved).toBe(claudeB);
  });

  it('uses reviewer default config for reviewer role', async () => {
    await db('users').where({ id: userId }).update({ reviewer_default_config_id: claudeB });
    const resolved = await resolveAgentConfigIdForRepoSdk(db, userId, repoId, 'claude', {
      role: 'reviewer',
    });
    expect(resolved).toBe(claudeB);
  });

  it('uses oldest config for sdk when no default or last session', async () => {
    const resolved = await resolveAgentConfigIdForRepoSdk(db, userId, repoId, 'claude');
    expect(resolved).toBe(claudeA);
  });

  it('falls back to last session config when no user default', async () => {
    await db('sessions').insert({
      user_id: userId,
      repo_full_name: 'org/other',
      base_branch: 'main',
      initial_prompt: 'x',
      agent_sdk: 'claude',
      agent_config_id: claudeB,
      model: 'sonnet',
    });
    const resolved = await resolveAgentConfigIdForRepoSdk(db, userId, repoId, 'claude');
    expect(resolved).toBe(claudeB);
  });
});
