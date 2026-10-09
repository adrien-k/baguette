import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { encrypt } from '../../lib/encrypt.js';
import { backfillConfigsForScope } from '../053_agent_configs.js';
import {
  accountAgentConfigLabel,
  repoAgentConfigLabel,
} from '../../../shared/agent-config-labels.js';
import { buildUserRepoDefaultsPatch } from '../lib/user-repo-defaults-backfill.js';

describe('user-repo-defaults-backfill', () => {
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
    await db.schema.createTable('repos', (t) => {
      t.increments('id').primary();
      t.string('full_name');
    });
    await db.schema.createTable('user_repos', (t) => {
      t.increments('id').primary();
      t.integer('user_id');
      t.integer('repo_id');
      t.text('anthropic_api_key_encrypted');
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
      t.string('model');
      t.text('model_params');
      t.string('agent_sdk');
      t.integer('review_agent_config_id');
      t.string('review_model');
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

  it('maps legacy per-repo credentials to repo-scoped agent config id', async () => {
    const [userId] = await db('users').insert({ github_id: 1, username: 'u', approved: true });
    const [repoId] = await db('repos').insert({ full_name: 'org/repo' });
    const [linkId] = await db('user_repos').insert({
      user_id: userId,
      repo_id: repoId,
      anthropic_api_key_encrypted: encrypt('repo-key'),
    });
    const link = await db('user_repos').where({ id: linkId }).first();
    const repoScope = await backfillConfigsForScope(
      db,
      userId,
      { anthropic_api_key_encrypted: encrypt('repo-key') },
      (sdk) => repoAgentConfigLabel(sdk, 'org/repo')
    );

    const patch = await buildUserRepoDefaultsPatch(db, link, repoScope);
    expect(patch?.agent_default_config_id).toBe(repoScope.primary);
  });

  it('does not assign account config when repo had legacy credentials', async () => {
    const [userId] = await db('users').insert({ github_id: 2, username: 'u2', approved: true });
    const [repoId] = await db('repos').insert({ full_name: 'org/repo' });
    const [linkId] = await db('user_repos').insert({
      user_id: userId,
      repo_id: repoId,
      anthropic_api_key_encrypted: encrypt('repo-key'),
    });
    const link = await db('user_repos').where({ id: linkId }).first();
    const repoScope = await backfillConfigsForScope(
      db,
      userId,
      { anthropic_api_key_encrypted: encrypt('repo-key') },
      (sdk) => repoAgentConfigLabel(sdk, 'org/repo')
    );

    const patch = await buildUserRepoDefaultsPatch(db, link, repoScope);
    expect(patch?.agent_default_config_id).toBe(repoScope.primary);
  });

  it('sets the repo override config even when the last session used another sdk', async () => {
    const [userId] = await db('users').insert({ github_id: 3, username: 'u3', approved: true });
    const [repoId] = await db('repos').insert({ full_name: 'org/over' });
    const [linkId] = await db('user_repos').insert({
      user_id: userId,
      repo_id: repoId,
      anthropic_api_key_encrypted: encrypt('repo-key'),
    });
    const link = await db('user_repos').where({ id: linkId }).first();
    const repoScope = await backfillConfigsForScope(
      db,
      userId,
      { anthropic_api_key_encrypted: encrypt('repo-key') },
      (sdk) => repoAgentConfigLabel(sdk, 'org/over')
    );
    const accountScope = await backfillConfigsForScope(
      db,
      userId,
      { anthropic_api_key_encrypted: encrypt('acc'), cursor_api_key_encrypted: encrypt('cur') },
      (sdk) => accountAgentConfigLabel(sdk)
    );
    await db('sessions').insert({
      user_id: userId,
      repo_id: repoId,
      agent_sdk: 'cursor',
      agent_config_id: accountScope.cursor,
      model: 'default',
    });

    const patch = await buildUserRepoDefaultsPatch(db, link, repoScope);
    expect(patch?.agent_default_config_id).toBe(repoScope.primary);
    expect(patch?.agent_default_model).toBeNull();
    expect(patch?.reviewer_default_config_id).toBe(repoScope.primary);
  });

  it('pins the last session model for repos without overrides', async () => {
    const [userId] = await db('users').insert({ github_id: 4, username: 'u4', approved: true });
    const [repoId] = await db('repos').insert({ full_name: 'org/plain' });
    const [linkId] = await db('user_repos').insert({ user_id: userId, repo_id: repoId });
    const link = await db('user_repos').where({ id: linkId }).first();
    const [configId] = await db('agent_configs').insert({
      user_id: userId,
      label: 'Claude',
      sdk: 'claude',
      api_key_encrypted: encrypt('k'),
      api_key_env_var: 'ANTHROPIC_API_KEY',
    });
    await db('sessions').insert({
      user_id: userId,
      repo_id: repoId,
      agent_sdk: 'claude',
      agent_config_id: configId,
      model: 'sonnet-4',
    });

    const patch = await buildUserRepoDefaultsPatch(db, link, null);
    expect(patch?.agent_default_config_id).toBe(configId);
    expect(patch?.agent_default_model).toBe(
      JSON.stringify({ model: 'sonnet-4', model_params: null })
    );
    expect(patch?.reviewer_default_config_id).toBe(configId);
  });
});
