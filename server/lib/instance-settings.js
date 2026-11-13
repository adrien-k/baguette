import { encrypt, decrypt } from './encrypt.js';

/** @type {null | Awaited<ReturnType<typeof loadGithubAppConfig>>} */
let cachedGithubConfig = null;

export function invalidateGithubAppCache() {
  cachedGithubConfig = null;
}

async function loadGithubAppConfig(db) {
  const row = await db('instance_settings').where({ id: 1 }).first();
  if (!row) {
    return {
      configured: false,
      client_id: null,
      client_secret: null,
      slug: null,
      app_id: null,
      install_url: null,
    };
  }

  const client_id = row.github_app_client_id || null;
  const client_secret = row.github_app_client_secret_encrypted
    ? decrypt(row.github_app_client_secret_encrypted)
    : null;
  const slug = row.github_app_slug || null;
  const configured = !!(client_id && client_secret && slug);
  const install_url = slug ? `https://github.com/apps/${slug}/installations/new` : null;

  return {
    configured,
    client_id,
    client_secret,
    slug,
    app_id: row.github_app_id ?? null,
    install_url,
  };
}

export async function getGithubAppConfig(db) {
  if (cachedGithubConfig) return cachedGithubConfig;
  cachedGithubConfig = await loadGithubAppConfig(db);
  return cachedGithubConfig;
}

/**
 * Insert the singleton instance_settings row when missing. Legacy AUTH_GITHUB_* env vars seed
 * the first row only; existing rows are never updated from env.
 */
export async function seedInstanceSettings(db) {
  const existing = await db('instance_settings').where({ id: 1 }).first();
  if (existing) return;

  const clientId = process.env.AUTH_GITHUB_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.AUTH_GITHUB_CLIENT_SECRET?.trim() || null;
  const slug = process.env.AUTH_GITHUB_APP_SLUG?.trim() || null;

  if (clientId && clientSecret && slug) {
    await db('instance_settings').insert({
      id: 1,
      github_app_client_id: clientId,
      github_app_client_secret_encrypted: encrypt(clientSecret),
      github_app_slug: slug,
      github_app_id: null,
      github_app_private_key_encrypted: null,
      github_app_webhook_secret_encrypted: null,
    });
  } else {
    await db('instance_settings').insert({ id: 1 });
  }

  invalidateGithubAppCache();
}
