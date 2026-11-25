import { randomBytes } from 'crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

/** Prefix scoped by the public-read policy. The rest of the key is the secret. */
const OBJECT_KEY_PREFIX = 'baguette/';

export function isPublicStorageConfigured(config) {
  if (!config) return false;
  return !!(
    config.endpoint_url &&
    config.bucket &&
    config.access_key_id &&
    config.secret_access_key &&
    config.public_base_url
  );
}

/**
 * Object name used as a capability: 256 bits from a CSPRNG, not the session id
 * or the `{{image:slug}}` placeholder. The extension is only a content hint.
 */
export function createUnguessableObjectKey(fileExt) {
  const ext = typeof fileExt === 'string' && /^\.[a-z0-9]+$/i.test(fileExt) ? fileExt : '';
  return `${OBJECT_KEY_PREFIX}${randomBytes(32).toString('base64url')}${ext}`;
}

/** Key embedded in a public URL, or null when the URL is not under this base. */
export function objectKeyFromPublicUrl(publicBaseUrl, publicUrl) {
  if (!publicBaseUrl || !publicUrl) return null;
  const prefix = `${publicBaseUrl.replace(/\/$/, '')}/`;
  if (!publicUrl.startsWith(prefix)) return null;
  const key = publicUrl.slice(prefix.length).split('?')[0];
  if (!key.startsWith(OBJECT_KEY_PREFIX) || key.includes('..') || key.includes('\\')) return null;
  return key;
}

export function publicObjectUrl(publicBaseUrl, key) {
  const base = publicBaseUrl.replace(/\/$/, '');
  return `${base}/${key}`;
}

function s3Client(config) {
  return new S3Client({
    region: config.region?.trim() || 'us-east-1',
    endpoint: config.endpoint_url,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.access_key_id,
      secretAccessKey: config.secret_access_key,
    },
  });
}

export async function uploadPublicObject({ config, key, body, mediaType }) {
  const client = s3Client(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: mediaType,
    })
  );
}

function isNotFoundError(err) {
  const code = err?.name || err?.Code || err?.code;
  return code === 'NoSuchKey' || code === 'NotFound' || code === '404';
}

export async function deletePublicObject({ config, key }) {
  const client = s3Client(config);
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}
