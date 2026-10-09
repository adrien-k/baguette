import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';
import {
  assertAgentConfigOnCreate,
  resolveAgentConfigIdForRepoSdk,
  resolveEffectiveAgentDefaults,
  resolveSessionFormDefaults,
} from '../agent-config-resolver.js';
import { feathers } from '@feathersjs/feathers';
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

  it('prefers stored repo defaults over account defaults', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'org/scoped',
      repo_path: '/tmp/scoped',
    });
    await db('user_repos').insert({
      user_id: userId,
      repo_id: repoId,
      agent_default_config_id: claudeConfigId,
      agent_default_model: JSON.stringify({ model: 'haiku', model_params: null }),
    });
    await db('users')
      .where({ id: userId })
      .update({
        agent_default_config_id: cursorConfigId,
        agent_default_model: JSON.stringify({ model: 'composer', model_params: null }),
      });

    const resolved = await resolveEffectiveAgentDefaults(db, userId, repoId);
    expect(resolved).toMatchObject({
      agent_config_id: claudeConfigId,
      model: 'haiku',
      source: 'repo',
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

describe('assertAgentConfigOnCreate reviewer defaults', () => {
  let userId;
  let claudeConfigId;
  let cursorConfigId;
  let repoId;

  beforeEach(async () => {
    await db('users').insert({ github_id: 3, username: 'create-user', approved: true });
    const user = await db('users').where({ username: 'create-user' }).first();
    userId = user.id;
    claudeConfigId = await insertTestAgentConfig(db, userId, { apiKey: 'sk-ant' });
    cursorConfigId = await insertTestAgentConfig(db, userId, {
      sdk: 'cursor',
      apiKey: 'cursor-key',
      apiKeyEnvVar: null,
    });
    [repoId] = await db('repos').insert({
      full_name: 'org/review-repo',
      repo_path: '/tmp/review-repo',
    });
  });

  it('applies repo reviewer defaults instead of copying the builder config', async () => {
    await db('user_repos').insert({
      user_id: userId,
      repo_id: repoId,
      reviewer_default_config_id: cursorConfigId,
      reviewer_default_model: JSON.stringify({ model: 'composer', model_params: null }),
    });
    const app = feathers();
    app.set('db', db);
    const data = {
      repo_id: repoId,
      agent_config_id: claudeConfigId,
      agent_sdk: 'claude',
    };
    await assertAgentConfigOnCreate({ app, params: { user: { id: userId } }, data });
    expect(data.review_agent_config_id).toBe(cursorConfigId);
    expect(data.review_agent_sdk).toBe('cursor');
    expect(data.review_model).toBe('composer');
  });

  it('leaves review fields unset when no repo or account reviewer default', async () => {
    await db('user_repos').insert({ user_id: userId, repo_id: repoId });
    const app = feathers();
    app.set('db', db);
    const data = {
      repo_id: repoId,
      agent_config_id: claudeConfigId,
      agent_sdk: 'claude',
    };
    await assertAgentConfigOnCreate({ app, params: { user: { id: userId } }, data });
    expect(data.review_agent_config_id).toBeUndefined();
    expect(data.review_agent_sdk).toBeUndefined();
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

  it('uses repo default config before account default', async () => {
    await db('user_repos').insert({
      user_id: userId,
      repo_id: repoId,
      agent_default_config_id: claudeA,
    });
    await db('users').where({ id: userId }).update({ agent_default_config_id: claudeB });
    const resolved = await resolveAgentConfigIdForRepoSdk(db, userId, repoId, 'claude');
    expect(resolved).toBe(claudeA);
  });

  it('uses account default when repo default is for a different sdk', async () => {
    const cursorConfigId = await insertTestAgentConfig(db, userId, {
      sdk: 'cursor',
      apiKey: 'cursor-key',
      apiKeyEnvVar: null,
    });
    await db('user_repos').insert({
      user_id: userId,
      repo_id: repoId,
      agent_default_config_id: claudeA,
    });
    await db('users').where({ id: userId }).update({ agent_default_config_id: cursorConfigId });
    const resolved = await resolveAgentConfigIdForRepoSdk(db, userId, repoId, 'cursor');
    expect(resolved).toBe(cursorConfigId);
  });

  it('uses agent default config when repo has no default', async () => {
    await db('user_repos').insert({ user_id: userId, repo_id: repoId });
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
