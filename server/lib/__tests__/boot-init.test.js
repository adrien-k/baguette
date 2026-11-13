import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Knex from 'knex';
import { fileURLToPath } from 'url';

const migrationsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

describe('encryption key file init', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baguette-key-test-'));
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.DATA_DIR = tmpDir;
    delete process.env.ENCRYPTION_KEY;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function loadConfig() {
    return import('../../config.js');
  }

  it('generates a key file when none exists and env is unset', async () => {
    const { ENCRYPTION_KEY } = await loadConfig();
    const keyPath = path.join(tmpDir, 'encryption.key');
    const fileContent = fs.readFileSync(keyPath, 'utf8').trim();
    expect(fileContent.length).toBeGreaterThanOrEqual(32);
    expect(ENCRYPTION_KEY).toBe(fileContent);
  });

  it('copies ENCRYPTION_KEY from env when the file is missing', async () => {
    const envKey = 'legacy-env-encryption-key-32chars!!';
    process.env.ENCRYPTION_KEY = envKey;
    const { ENCRYPTION_KEY } = await loadConfig();
    const fileContent = fs.readFileSync(path.join(tmpDir, 'encryption.key'), 'utf8').trim();
    expect(fileContent).toBe(envKey);
    expect(ENCRYPTION_KEY).toBe(envKey);
  });

  it('copies a short legacy ENCRYPTION_KEY instead of generating a replacement', async () => {
    const envKey = 'short-legacy-key';
    process.env.ENCRYPTION_KEY = envKey;
    const { ENCRYPTION_KEY } = await loadConfig();
    const fileContent = fs.readFileSync(path.join(tmpDir, 'encryption.key'), 'utf8').trim();
    expect(fileContent).toBe(envKey);
    expect(ENCRYPTION_KEY).toBe(envKey);
  });

  it('keeps an existing file when env differs', async () => {
    const keyPath = path.join(tmpDir, 'encryption.key');
    const onDisk = 'on-disk-encryption-key-32-characters!!';
    fs.writeFileSync(keyPath, onDisk, { mode: 0o600 });
    process.env.ENCRYPTION_KEY = 'different-env-key-32-characters-long!!';
    const { ENCRYPTION_KEY } = await loadConfig();
    expect(fs.readFileSync(keyPath, 'utf8').trim()).toBe(onDisk);
    expect(ENCRYPTION_KEY).toBe(onDisk);
  });

  it('writes the key file with mode 0600', async () => {
    await loadConfig();
    const stat = fs.statSync(path.join(tmpDir, 'encryption.key'));
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

async function createMigratedDb() {
  const db = Knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: { directory: migrationsPath },
  });
  await db.migrate.latest();
  return db;
}

describe('seedInstanceSettings', () => {
  let db;
  let settingsDataDir;
  const savedEnv = {};

  beforeEach(async () => {
    vi.resetModules();
    settingsDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baguette-settings-test-'));
    for (const key of [
      'AUTH_GITHUB_CLIENT_ID',
      'AUTH_GITHUB_CLIENT_SECRET',
      'AUTH_GITHUB_APP_SLUG',
      'ENCRYPTION_KEY',
      'DATA_DIR',
    ]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.NODE_ENV = 'test';
    process.env.DATA_DIR = settingsDataDir;
    process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
    db = await createMigratedDb();
    const { invalidateGithubAppCache } = await import('../instance-settings.js');
    invalidateGithubAppCache();
  });

  afterEach(async () => {
    await db?.destroy();
    if (settingsDataDir) fs.rmSync(settingsDataDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('inserts a populated row when legacy env is set', async () => {
    process.env.AUTH_GITHUB_CLIENT_ID = 'cid';
    process.env.AUTH_GITHUB_CLIENT_SECRET = 'csecret';
    process.env.AUTH_GITHUB_APP_SLUG = 'my-app';
    const { seedInstanceSettings } = await import('../instance-settings.js');
    const { decrypt } = await import('../encrypt.js');
    await seedInstanceSettings(db);
    const row = await db('instance_settings').where({ id: 1 }).first();
    expect(row.github_app_client_id).toBe('cid');
    expect(row.github_app_slug).toBe('my-app');
    expect(decrypt(row.github_app_client_secret_encrypted)).toBe('csecret');
  });

  it('inserts an empty row when legacy env is unset', async () => {
    const { seedInstanceSettings } = await import('../instance-settings.js');
    await seedInstanceSettings(db);
    const row = await db('instance_settings').where({ id: 1 }).first();
    expect(row.github_app_client_id).toBeNull();
    expect(row.github_app_client_secret_encrypted).toBeNull();
    expect(row.github_app_slug).toBeNull();
  });

  it('does not overwrite an existing row when env changes', async () => {
    process.env.AUTH_GITHUB_CLIENT_ID = 'first-id';
    process.env.AUTH_GITHUB_CLIENT_SECRET = 'first-secret';
    process.env.AUTH_GITHUB_APP_SLUG = 'first-slug';
    const { seedInstanceSettings } = await import('../instance-settings.js');
    const { decrypt } = await import('../encrypt.js');
    await seedInstanceSettings(db);

    process.env.AUTH_GITHUB_CLIENT_ID = 'second-id';
    process.env.AUTH_GITHUB_CLIENT_SECRET = 'second-secret';
    process.env.AUTH_GITHUB_APP_SLUG = 'second-slug';
    await seedInstanceSettings(db);

    const row = await db('instance_settings').where({ id: 1 }).first();
    expect(row.github_app_client_id).toBe('first-id');
    expect(decrypt(row.github_app_client_secret_encrypted)).toBe('first-secret');
    expect(row.github_app_slug).toBe('first-slug');
  });
});
