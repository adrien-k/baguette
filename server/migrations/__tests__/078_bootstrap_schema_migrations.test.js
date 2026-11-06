import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Knex from 'knex';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsPath = path.join(__dirname, '..');

// First migration of the bootstrap-without-GitHub schema series.
// Keep this distinct from other 078+ files landed on main (e.g. session_plans).
const FIRST_BOOTSTRAP_MIGRATION = /^078_users_github_id_nullable/;
// migrate.latest() from the pre-078 stop applies every later file in one batch,
// including migrations added after the original bootstrap series.
const bootstrapBatchSize = fs
  .readdirSync(migrationsPath)
  .filter((name) => name.endsWith('.js') && name >= '078_users_github_id_nullable').length;

async function columnInfo(db, table) {
  const rows = await db.raw(`PRAGMA table_info(${table})`);
  return Array.isArray(rows) ? rows : [];
}

function columnOf(rows, name) {
  return rows.find((c) => c.name === name) ?? null;
}

async function fkTargets(db, table) {
  const rows = await db.raw(`PRAGMA foreign_key_list(${table})`);
  return (Array.isArray(rows) ? rows : []).map((r) => r.table);
}

describe('bootstrap schema migrations (078+)', () => {
  let db;

  beforeEach(async () => {
    db = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      migrations: { directory: migrationsPath },
    });
    // Run the real chain up to (not including) 078 so rows can be seeded into a
    // pre-migration schema exactly like a live install at 077.
    for (;;) {
      const [, pending] = await db.migrate.list();
      const next = pending[0]?.file ?? '';
      if (!next || FIRST_BOOTSTRAP_MIGRATION.test(next)) break;
      await db.migrate.up();
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  /**
   * Seed a user + repo + session + usage + user_repos at the pre-078 schema so the
   * users rebuild runs with real FK rows pointing at users.
   */
  async function seedUserWithRepoAndSession({ approved = true, githubId = 42, suffix = '' } = {}) {
    const userFields = { username: `alice${suffix}`, approved };
    if (githubId !== null) userFields.github_id = githubId;
    const [userId] = await db('users').insert(userFields);
    const [repoId] = await db('repos').insert({
      full_name: `org/repo${suffix}`,
      repo_path: `repos/org/repo${suffix}`,
    });
    const [sessionId] = await db('sessions').insert({
      user_id: userId,
      repo_id: repoId,
      repo_full_name: `org/repo${suffix}`,
      base_branch: 'main',
      initial_prompt: 'hello',
    });
    await db('user_repos').insert({ user_id: userId, repo_id: repoId });
    await db('usage').insert({
      user_id: userId,
      session_id: sessionId,
      repo_full_name: `org/repo${suffix}`,
      cost_usd: 0.5,
    });
    return { userId, repoId, sessionId };
  }

  it('makes github_id nullable without breaking user/session/usage/user_repo FK rows', async () => {
    const { userId, repoId, sessionId } = await seedUserWithRepoAndSession();

    // Sanity: the pre-078 schema still requires github_id.
    await expect(db('users').insert({ github_id: null, username: 'prestate' })).rejects.toThrow();

    await db.migrate.latest();

    const gh = columnOf(await columnInfo(db, 'users'), 'github_id');
    expect(gh).toBeTruthy();
    expect(gh.notnull).toBe(0);

    // Unique index kept under its original name.
    const indexes = await db.raw('PRAGMA index_list(users)');
    expect(indexes.some((i) => i.name === 'users_github_id_unique' && i.unique === 1)).toBe(true);

    // FK relationships preserved in both directions.
    expect(await fkTargets(db, 'sessions')).toContain('users');
    expect(await fkTargets(db, 'user_repos')).toContain('users');
    expect(await fkTargets(db, 'usage')).toContain('users');
    expect(await fkTargets(db, 'agent_configs')).toContain('users');
    expect(await fkTargets(db, 'secrets')).toContain('users');
    const usersOutbound = await fkTargets(db, 'users');
    expect(usersOutbound.filter((t) => t === 'agent_configs')).toHaveLength(3);

    expect(await db.raw('PRAGMA foreign_key_check')).toHaveLength(0);

    // Rows survived the rebuild.
    expect((await db('users').where({ id: userId }).first()).github_id).toBe(42);
    expect((await db('sessions').where({ id: sessionId }).first()).user_id).toBe(userId);
    expect(await db('usage').where({ user_id: userId })).toHaveLength(1);
    expect((await db('user_repos').where({ user_id: userId }).first()).repo_id).toBe(repoId);
  });

  it('still enforces github_id uniqueness while allowing multiple NULLs', async () => {
    await seedUserWithRepoAndSession();
    await db.migrate.latest();

    // github_id inserts still work.
    await db('users').insert({ github_id: 43, username: 'bob', status: 'approved' });
    // Duplicate github_id is still rejected.
    await expect(db('users').insert({ github_id: 43, username: 'bob2' })).rejects.toThrow();
    // Non-GitHub users can share NULL github_id.
    await db('users').insert({ github_id: null, username: 'local1', status: 'approved' });
    await db('users').insert({ github_id: null, username: 'local2', status: 'pending' });
    expect(await db('users').whereNull('github_id')).toHaveLength(2);
  });

  it('keeps id AUTOINCREMENT continuity across the rebuild', async () => {
    const { userId } = await seedUserWithRepoAndSession();
    await db.migrate.latest();
    const [newId] = await db('users').insert({ github_id: 7, username: 'after' });
    expect(newId).toBeGreaterThan(userId);
  });

  it('backfills admin from approved and defaults new users to non-admin', async () => {
    await seedUserWithRepoAndSession({ approved: true, githubId: 42, suffix: 'a' });
    await seedUserWithRepoAndSession({ approved: false, githubId: 43, suffix: 'b' });
    await db.migrate.latest();

    expect((await db('users').where({ username: 'alicea' }).first()).admin).toBe(1);
    expect((await db('users').where({ username: 'aliceb' }).first()).admin).toBe(0);

    // New inserts default to non-admin regardless of approval.
    const [newId] = await db('users').insert({
      github_id: 44,
      username: 'newbie',
      status: 'approved',
    });
    expect((await db('users').where({ id: newId }).first()).admin).toBe(0);
  });

  it('creates an empty instance_settings singleton pinned to id=1', async () => {
    await db.migrate.latest();

    const names = (await columnInfo(db, 'instance_settings')).map((c) => c.name);
    for (const name of [
      'id',
      'github_app_id',
      'github_app_slug',
      'github_app_client_id',
      'github_app_client_secret_encrypted',
      'github_app_private_key_encrypted',
      'github_app_webhook_secret_encrypted',
      'created_at',
      'updated_at',
    ]) {
      expect(names).toContain(name);
    }

    // No row seeded; CHECK (id = 1) enforced.
    expect(await db('instance_settings')).toHaveLength(0);
    await expect(db('instance_settings').insert({ id: 2 })).rejects.toThrow();
    await db('instance_settings').insert({ id: 1 });
    await expect(db('instance_settings').insert({ id: 1 })).rejects.toThrow();
  });

  it('creates user_passkeys with user FK and unique credential_id', async () => {
    const { userId } = await seedUserWithRepoAndSession();
    await db.migrate.latest();

    const names = (await columnInfo(db, 'user_passkeys')).map((c) => c.name);
    for (const name of [
      'id',
      'user_id',
      'credential_id',
      'public_key',
      'counter',
      'transports',
      'device_type',
      'backed_up',
      'created_at',
    ]) {
      expect(names).toContain(name);
    }

    await db('user_passkeys').insert({
      user_id: userId,
      credential_id: 'cred-1',
      public_key: 'pk-data',
    });
    await expect(
      db('user_passkeys').insert({ user_id: userId, credential_id: 'cred-1', public_key: 'other' })
    ).rejects.toThrow();
    await expect(
      db('user_passkeys').insert({
        user_id: userId + 1000,
        credential_id: 'cred-2',
        public_key: 'x',
      })
    ).rejects.toThrow();

    const passkey = await db('user_passkeys').where({ credential_id: 'cred-1' }).first();
    expect(passkey.user_id).toBe(userId);
    expect(passkey.counter).toBe(0);
    expect(passkey.backed_up).toBe(0);
    expect(passkey.transports).toBeNull();
  });

  it('adds users invite token columns without rebuilding users', async () => {
    const { userId } = await seedUserWithRepoAndSession();
    await db.migrate.latest();

    const cols = await columnInfo(db, 'users');
    expect(columnOf(cols, 'invite_token_hash')).toBeTruthy();
    expect(columnOf(cols, 'invite_expires_at')).toBeTruthy();
    expect((await db('users').where({ id: userId }).first()).invite_token_hash).toBeNull();

    await db('users').where({ id: userId }).update({
      invite_token_hash: 'abc',
      invite_expires_at: new Date().toISOString(),
    });
    await expect(
      db('users').insert({
        github_id: 99,
        username: 'other',
        status: 'approved',
        invite_token_hash: 'abc',
      })
    ).rejects.toThrow();
  });

  it('adds repos.access_mode with local/github backfill', async () => {
    const { repoId } = await seedUserWithRepoAndSession();
    await db('repos').where({ id: repoId }).update({
      origin: 'https://github.com/org/repo.git',
    });
    await db('repos').insert({ full_name: 'local/repo', repo_path: 'repos/local/repo' });
    await db.migrate.latest();

    const am = columnOf(await columnInfo(db, 'repos'), 'access_mode');
    expect(am).toBeTruthy();
    expect(am.notnull).toBe(1);
    expect(String(am.dflt_value)).toContain('github');

    expect((await db('repos').where({ id: repoId }).first()).access_mode).toBe('github');
    expect((await db('repos').where({ full_name: 'local/repo' }).first()).access_mode).toBe(
      'local'
    );

    // New rows default to github.
    const [newRepoId] = await db('repos').insert({
      full_name: 'fresh/repo',
      repo_path: 'repos/fresh/repo',
    });
    expect((await db('repos').where({ id: newRepoId }).first()).access_mode).toBe('github');
  });

  it('rolls the whole batch back and re-migrates cleanly', async () => {
    const { userId } = await seedUserWithRepoAndSession();
    await db.migrate.latest();
    expect((await db('users').where({ id: userId }).first()).admin).toBe(1);

    const [, rolledBack] = await db.migrate.rollback();
    expect(rolledBack).toHaveLength(bootstrapBatchSize);

    const names = (await columnInfo(db, 'users')).map((c) => c.name);
    expect(columnOf(await columnInfo(db, 'users'), 'github_id').notnull).toBe(1);
    expect(names).not.toContain('admin');
    expect(names).not.toContain('invite_token_hash');
    expect(names).not.toContain('invite_expires_at');
    expect(await db.schema.hasTable('instance_settings')).toBe(false);
    expect(await db.schema.hasTable('user_passkeys')).toBe(false);
    expect((await columnInfo(db, 'repos')).map((c) => c.name)).not.toContain('access_mode');

    // User data survived the round trip; the batch applies again.
    expect((await db('users').where({ id: userId }).first()).github_id).toBe(42);
    await db.migrate.latest();
    expect((await db('users').where({ id: userId }).first()).admin).toBe(1);
  });
});
