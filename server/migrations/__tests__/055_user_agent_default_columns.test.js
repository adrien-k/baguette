import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { encrypt } from '../../lib/encrypt.js';
import { up as userAgentDefaultColumnsUp } from '../055_user_agent_default_columns.js';
import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
} from '../../../shared/agent-config-api-key-env.js';
import { CLAUDE_TOKEN_LABEL, repoAgentTokenLabel } from '../../../shared/agent-config-labels.js';

describe('055_user_agent_default_columns', () => {
  let db;

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32bytes!!';
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.integer('github_id');
      t.string('username');
      t.boolean('approved');
      t.text('agent_defaults');
    });
    await db.schema.createTable('agent_configs', (t) => {
      t.increments('id').primary();
      t.integer('user_id');
      t.string('label');
      t.string('sdk');
      t.text('api_url');
      t.text('api_key_encrypted');
      t.string('api_key_env_var');
      t.text('extra_env_json');
      t.timestamp('created_at');
      t.timestamp('updated_at');
    });
    await db.schema.createTable('sessions', (t) => {
      t.increments('id').primary();
      t.integer('user_id');
      t.integer('repo_id');
      t.integer('agent_config_id');
      t.text('model');
      t.text('model_params');
      t.string('agent_sdk');
      t.integer('review_agent_config_id');
      t.text('review_model');
      t.text('review_model_params');
      t.string('review_agent_sdk');
      t.timestamp('created_at');
      t.timestamp('updated_at');
      t.timestamp('last_activity_at');
      t.timestamp('archived_at');
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('seeds user defaults from fixed-mode agent_defaults over the last session', async () => {
    const [userId] = await db('users').insert({
      github_id: 1,
      username: 'u',
      approved: true,
      agent_defaults: JSON.stringify({
        agent_sdk: 'cursor',
        model: 'composer-2.5',
        model_params: [{ id: 'fast', value: 'true' }],
      }),
    });
    const [claudeId] = await db('agent_configs').insert({
      user_id: userId,
      label: 'Claude',
      sdk: 'claude',
      api_key_encrypted: encrypt('k'),
      api_key_env_var: ANTHROPIC_API_KEY_ENV,
    });
    const [cursorId] = await db('agent_configs').insert({
      user_id: userId,
      label: 'Cursor',
      sdk: 'cursor',
      api_key_encrypted: encrypt('c'),
    });
    await db('sessions').insert({
      user_id: userId,
      agent_config_id: claudeId,
      agent_sdk: 'claude',
      model: 'sonnet',
    });

    await userAgentDefaultColumnsUp(db);

    const user = await db('users').where({ id: userId }).first();
    expect(user.agent_default_config_id).toBe(cursorId);
    expect(user.agent_default_model).toBe(
      JSON.stringify({ model: 'composer-2.5', model_params: [{ id: 'fast', value: 'true' }] })
    );
    expect(user.reviewer_default_config_id).toBe(cursorId);
    expect(user.reviewer_default_model).toBe(user.agent_default_model);
    expect(await db.schema.hasColumn('users', 'agent_defaults')).toBe(false);
  });

  it('seeds from the last session when agent_defaults is absent', async () => {
    const [userId] = await db('users').insert({ github_id: 2, username: 'u2', approved: true });
    const [claudeId] = await db('agent_configs').insert({
      user_id: userId,
      label: 'Claude',
      sdk: 'claude',
      api_key_encrypted: encrypt('k'),
      api_key_env_var: ANTHROPIC_API_KEY_ENV,
    });
    await db('sessions').insert({
      user_id: userId,
      agent_config_id: claudeId,
      agent_sdk: 'claude',
      model: 'sonnet-4',
      review_agent_sdk: 'claude',
    });

    await userAgentDefaultColumnsUp(db);

    const user = await db('users').where({ id: userId }).first();
    expect(user.agent_default_config_id).toBe(claudeId);
    expect(user.agent_default_model).toBe(
      JSON.stringify({ model: 'sonnet-4', model_params: null })
    );
    expect(user.reviewer_default_config_id).toBe(claudeId);
  });

  it('seeds from the last session when agent_defaults is in last-used mode', async () => {
    const [userId] = await db('users').insert({
      github_id: 3,
      username: 'u3',
      approved: true,
      agent_defaults: JSON.stringify({ agent_sdk: null, model: 'ignored-model' }),
    });
    const [claudeId] = await db('agent_configs').insert({
      user_id: userId,
      label: 'Claude',
      sdk: 'claude',
      api_key_encrypted: encrypt('k'),
      api_key_env_var: ANTHROPIC_API_KEY_ENV,
    });
    await db('sessions').insert({
      user_id: userId,
      agent_config_id: claudeId,
      agent_sdk: 'claude',
      model: 'session-model',
    });

    await userAgentDefaultColumnsUp(db);

    const user = await db('users').where({ id: userId }).first();
    expect(user.agent_default_config_id).toBe(claudeId);
    expect(user.agent_default_model).toBe(
      JSON.stringify({ model: 'session-model', model_params: null })
    );
  });

  it('falls back to the last session when the defaults sdk has no account config', async () => {
    const [userId] = await db('users').insert({
      github_id: 4,
      username: 'u4',
      approved: true,
      agent_defaults: JSON.stringify({ agent_sdk: 'pi', model: 'pi-model' }),
    });
    const [claudeId] = await db('agent_configs').insert({
      user_id: userId,
      label: 'Claude',
      sdk: 'claude',
      api_key_encrypted: encrypt('k'),
      api_key_env_var: ANTHROPIC_API_KEY_ENV,
    });
    await db('sessions').insert({
      user_id: userId,
      agent_config_id: claudeId,
      agent_sdk: 'claude',
      model: 'session-model',
    });

    await userAgentDefaultColumnsUp(db);

    const user = await db('users').where({ id: userId }).first();
    expect(user.agent_default_config_id).toBe(claudeId);
    expect(user.agent_default_model).toBe(
      JSON.stringify({ model: 'session-model', model_params: null })
    );
  });

  it('completes for users with neither defaults nor sessions', async () => {
    const [userId] = await db('users').insert({ github_id: 5, username: 'u5', approved: true });

    await expect(userAgentDefaultColumnsUp(db)).resolves.toBeUndefined();

    const user = await db('users').where({ id: userId }).first();
    expect(user.agent_default_config_id).toBeNull();
    expect(user.agent_default_model).toBeNull();
    expect(await db.schema.hasColumn('users', 'agent_defaults')).toBe(false);
  });

  it('does not pick a repo-scoped token config as the account default', async () => {
    const [userId] = await db('users').insert({
      github_id: 6,
      username: 'u6',
      approved: true,
      agent_defaults: JSON.stringify({ agent_sdk: 'claude', model: 'sonnet' }),
    });
    // Mirrors 053's output for a repo token override with no account credentials: the repo
    // token row carries the repo short name, never the bare account token label.
    await db('agent_configs').insert({
      user_id: userId,
      label: repoAgentTokenLabel('org/repo'),
      sdk: 'claude',
      api_url: 'https://repo-gateway.example',
      api_key_encrypted: encrypt('repo-tok'),
      api_key_env_var: ANTHROPIC_AUTH_TOKEN_ENV,
    });

    await userAgentDefaultColumnsUp(db);

    const user = await db('users').where({ id: userId }).first();
    expect(user.agent_default_config_id).toBeNull();
    expect(user.agent_default_model).toBeNull();
    expect(user.reviewer_default_config_id).toBeNull();
  });

  it('seeds the account token config for fixed claude defaults with token-only auth', async () => {
    const [userId] = await db('users').insert({
      github_id: 7,
      username: 'u7',
      approved: true,
      agent_defaults: JSON.stringify({ agent_sdk: 'claude', model: 'sonnet' }),
    });
    const [accountTokenId] = await db('agent_configs').insert({
      user_id: userId,
      label: CLAUDE_TOKEN_LABEL,
      sdk: 'claude',
      api_key_encrypted: encrypt('account-tok'),
      api_key_env_var: ANTHROPIC_AUTH_TOKEN_ENV,
    });
    await db('agent_configs').insert({
      user_id: userId,
      label: repoAgentTokenLabel('org/repo'),
      sdk: 'claude',
      api_key_encrypted: encrypt('repo-tok'),
      api_key_env_var: ANTHROPIC_AUTH_TOKEN_ENV,
    });

    await userAgentDefaultColumnsUp(db);

    const user = await db('users').where({ id: userId }).first();
    expect(user.agent_default_config_id).toBe(accountTokenId);
    expect(user.reviewer_default_config_id).toBe(accountTokenId);
    expect(await db.schema.hasColumn('users', 'agent_defaults')).toBe(false);
  });
});
