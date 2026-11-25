import { decrypt } from './encrypt.js';

/** @type {null | Awaited<ReturnType<typeof loadPublicStorageConfig>>} */
let cachedPublicStorageConfig = null;

export function invalidatePublicStorageCache() {
  cachedPublicStorageConfig = null;
}

function rowToConfig(row) {
  if (!row) {
    return {
      endpoint_url: null,
      bucket: null,
      region: null,
      access_key_id: null,
      secret_access_key: null,
      public_base_url: null,
    };
  }
  let secret_access_key = null;
  if (row.public_storage_secret_access_key_encrypted) {
    try {
      secret_access_key = decrypt(row.public_storage_secret_access_key_encrypted);
    } catch {
      secret_access_key = null;
    }
  }
  return {
    endpoint_url: row.public_storage_endpoint_url?.trim() || null,
    bucket: row.public_storage_bucket?.trim() || null,
    region: row.public_storage_region?.trim() || null,
    access_key_id: row.public_storage_access_key_id?.trim() || null,
    secret_access_key,
    public_base_url: row.public_storage_public_base_url?.trim() || null,
  };
}

async function loadPublicStorageConfig(db) {
  const row = await db('instance_settings').where({ id: 1 }).first();
  return rowToConfig(row);
}

export async function getPublicStorageConfig(db) {
  if (cachedPublicStorageConfig) return cachedPublicStorageConfig;
  cachedPublicStorageConfig = await loadPublicStorageConfig(db);
  return cachedPublicStorageConfig;
}

export function publicStorageConfiguredFromRow(row) {
  const endpoint = row?.public_storage_endpoint_url?.trim();
  const bucket = row?.public_storage_bucket?.trim();
  const accessKey = row?.public_storage_access_key_id?.trim();
  const secretEnc = row?.public_storage_secret_access_key_encrypted?.trim();
  const baseUrl = row?.public_storage_public_base_url?.trim();
  const credentialsOk = (accessKey && secretEnc) || (!accessKey && !secretEnc);
  return !!(endpoint && bucket && baseUrl && credentialsOk);
}

export async function publicStorageSettingsShape(db) {
  const row = await db('instance_settings').where({ id: 1 }).first();
  return {
    configured: publicStorageConfiguredFromRow(row),
    endpoint_url: row?.public_storage_endpoint_url?.trim() || null,
    bucket: row?.public_storage_bucket?.trim() || null,
    region: row?.public_storage_region?.trim() || null,
    access_key_id: row?.public_storage_access_key_id?.trim() || null,
    public_base_url: row?.public_storage_public_base_url?.trim() || null,
    secret_configured: Boolean(row?.public_storage_secret_access_key_encrypted?.trim()),
  };
}
