import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { encrypt } from '../../lib/encrypt.js';
import {
  backfillConfigsForScope,
  pickAgentConfigIdForSessionBackfill,
} from '../053_agent_configs.js';
import { repoAgentConfigLabel } from '../../../shared/agent-config-labels.js';
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

    const patch = await buildUserRepoDefaultsPatch(db, link, repoScope, null);
    expect(patch?.agent_default_config_id).toBe(
      pickAgentConfigIdForSessionBackfill(repoScope, null, 'claude')
    );
  });
});
