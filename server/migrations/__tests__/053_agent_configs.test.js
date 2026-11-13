import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import { encrypt } from '../../lib/encrypt.js';
import {
  backfillConfigsForScope,
  pickAgentConfigIdForSessionBackfill,
} from '../053_agent_configs.js';
import {
  accountAgentConfigLabel,
  repoAgentConfigLabel,
} from '../../../shared/agent-config-labels.js';

describe('053_agent_configs helpers', () => {
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
      t.text('anthropic_api_key_encrypted');
      t.text('anthropic_auth_token_encrypted');
    });
    await db.schema.createTable('repos', (t) => {
      t.increments('id').primary();
      t.string('full_name');
      t.string('repo_path');
    });
    await db.schema.createTable('user_repos', (t) => {
      t.increments('id').primary();
      t.integer('user_id');
      t.integer('repo_id');
      t.text('anthropic_api_key_encrypted');
    });
    await db.schema.createTable('agent_configs', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.string('label', 20).notNullable();
      t.string('sdk').notNullable();
      t.text('api_url').nullable();
      t.text('api_key_encrypted').nullable();
      t.string('api_key_env_var').nullable();
      t.text('extra_env_json').nullable();
      t.timestamp('created_at');
      t.timestamp('updated_at');
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('truncates per-repo labels and prefers repo config on session backfill', async () => {
    const [userId] = await db('users').insert({
      github_id: 100,
      username: 'u2',
      approved: true,
      anthropic_api_key_encrypted: encrypt('account-key'),
    });
    const [repoId] = await db('repos').insert({
      full_name: 'org/very-long-repository-name',
      repo_path: 'repos/org/very-long-repository-name',
    });
    await db('user_repos').insert({ user_id: userId, repo_id: repoId });
    await db('user_repos')
      .where({ user_id: userId, repo_id: repoId })
      .update({ anthropic_api_key_encrypted: encrypt('repo-key') });

    const repoScope = await backfillConfigsForScope(
      db,
      userId,
      {
        anthropic_api_key_encrypted: encrypt('repo-key'),
        anthropic_auth_token_encrypted: null,
        anthropic_base_url: null,
        cursor_api_key_encrypted: null,
      },
      (sdk) => repoAgentConfigLabel(sdk, 'org/very-long-repository-name')
    );

    expect(repoScope.primary).toBeTruthy();
    const accountScope = await backfillConfigsForScope(
      db,
      userId,
      {
        anthropic_api_key_encrypted: encrypt('account-key'),
        anthropic_auth_token_encrypted: null,
        anthropic_base_url: null,
        cursor_api_key_encrypted: null,
      },
      (sdk) => accountAgentConfigLabel(sdk)
    );

    const picked = pickAgentConfigIdForSessionBackfill(repoScope, accountScope, 'claude');
    expect(picked).toBe(repoScope.primary);
    expect(picked).not.toBe(accountScope.primary);
  });

  it('picks auth-token config for claude when only token was configured', async () => {
    const [userId] = await db('users').insert({
      github_id: 101,
      username: 'token-only',
      approved: true,
      anthropic_auth_token_encrypted: encrypt('tok-only'),
    });
    const scope = await backfillConfigsForScope(
      db,
      userId,
      {
        anthropic_api_key_encrypted: null,
        anthropic_auth_token_encrypted: encrypt('tok-only'),
        anthropic_base_url: null,
        cursor_api_key_encrypted: null,
      },
      (sdk) => accountAgentConfigLabel(sdk)
    );
    expect(scope.primary).toBeNull();
    expect(scope.token).toBeTruthy();
    expect(pickAgentConfigIdForSessionBackfill(null, scope, 'claude')).toBe(scope.token);
  });
});

describe('pickAgentConfigIdForSessionBackfill', () => {
  it('prefers Claude auth-token config when only token exists', () => {
    const scope = { primary: null, token: 42, cursor: null, pi: null };
    expect(pickAgentConfigIdForSessionBackfill(scope, undefined, 'claude')).toBe(42);
  });

  it('prefers Claude API-key config when only primary exists', () => {
    const scope = { primary: 11, token: null, cursor: null, pi: null };
    expect(pickAgentConfigIdForSessionBackfill(scope, undefined, 'claude')).toBe(11);
  });

  it('prefers primary when both Claude configs exist', () => {
    const scope = { primary: 11, token: 42, cursor: null, pi: null };
    expect(pickAgentConfigIdForSessionBackfill(scope, undefined, 'claude')).toBe(11);
  });

  it('uses repo scope before account scope', () => {
    const repo = { primary: 1, token: null, cursor: null, pi: null };
    const account = { primary: 2, token: null, cursor: null, pi: null };
    expect(pickAgentConfigIdForSessionBackfill(repo, account, 'claude')).toBe(1);
  });

  it('falls back to account scope when repo scope has no config for the sdk', () => {
    const repo = { primary: null, token: null, cursor: null, pi: null };
    const account = { primary: 2, token: null, cursor: null, pi: null };
    expect(pickAgentConfigIdForSessionBackfill(repo, account, 'claude')).toBe(2);
  });

  it('falls back to account scope only when repo scope is absent, not when it is empty', () => {
    const account = { primary: 2, token: null, cursor: null, pi: null };
    expect(pickAgentConfigIdForSessionBackfill(undefined, account, 'claude')).toBe(2);
    expect(
      pickAgentConfigIdForSessionBackfill(
        { primary: null, token: null, cursor: null, pi: null },
        null,
        'claude'
      )
    ).toBeNull();
  });
});
