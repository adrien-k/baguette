import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Knex from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encrypt } from '../../lib/encrypt.js';
import {
  up as agentConfigsUp,
  backfillConfigsForScope,
  pickAgentConfigIdForSessionBackfill,
} from '../053_agent_configs.js';
import {
  accountAgentConfigLabel,
  repoAgentConfigLabel,
} from '../../../shared/agent-config-labels.js';

const migrationsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('053_agent_configs', () => {
  let db;

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32bytes!!';
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('knex_migrations', (t) => {
      t.increments('id').primary();
      t.string('name');
      t.integer('batch');
      t.datetime('migration_time');
    });
    const files = fs
      .readdirSync(migrationsPath)
      .filter((f) => f.endsWith('.js') && f < '053_agent_configs.js')
      .sort();
    for (const file of files) {
      const mod = await import(pathToFileURL(path.join(migrationsPath, file)).href);
      await mod.up(db);
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('creates separate rows for claude key and token with expected env vars', async () => {
    const [userId] = await db('users').insert({
      github_id: 99,
      username: 'u',
      approved: true,
      anthropic_api_key_encrypted: encrypt('sk-ant'),
      anthropic_auth_token_encrypted: encrypt('tok'),
    });
    await agentConfigsUp(db);
    const rows = await db('agent_configs').where({ user_id: userId }).orderBy('id', 'asc');
    expect(rows).toHaveLength(2);
    expect(rows[0].label).toBe(accountAgentConfigLabel('claude'));
    expect(rows[0].api_key_env_var).toBe('ANTHROPIC_API_KEY');
    expect(rows[1].label).toBe('Claude token');
    expect(rows[1].api_key_env_var).toBe('ANTHROPIC_AUTH_TOKEN');
  });

  it('creates a Pi config from users.pi_* during migration', async () => {
    const [userId] = await db('users').insert({
      github_id: 102,
      username: 'pi-user',
      approved: true,
      pi_api_key_encrypted: encrypt('pi-secret'),
      pi_api_key_env_var: 'OPENAI_API_KEY',
    });
    await agentConfigsUp(db);
    const piRow = await db('agent_configs').where({ user_id: userId, sdk: 'pi' }).first();
    expect(piRow).toBeTruthy();
    expect(piRow.api_key_env_var).toBe('OPENAI_API_KEY');
    const user = await db('users').where({ id: userId }).first();
    expect(user.pi_api_key_encrypted).toBeUndefined();
  });

  it('truncates per-repo labels and prefers repo config on session backfill', async () => {
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
