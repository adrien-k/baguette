/** Saved secret still applies unless the user explicitly edited the secret field. */
export function publicStorageHasSavedSecret(secretConfigured, secretAccessKey, secretDirty) {
  if (secretDirty) return Boolean(String(secretAccessKey ?? '').trim());
  return secretConfigured;
}

/**
 * Request body for admin/public-storage test (saved row merged with unsaved form fields).
 * @param {object} form
 * @param {string} secretAccessKey
 * @param {boolean} secretConfigured
 * @param {boolean} [secretDirty]
 */
export function buildPublicStorageTestPayload(
  form,
  secretAccessKey,
  secretConfigured,
  secretDirty = false
) {
  const payload = {
    endpoint_url: String(form.endpoint_url ?? '').trim(),
    bucket: String(form.bucket ?? '').trim(),
    region: String(form.region ?? '').trim(),
    access_key_id: String(form.access_key_id ?? '').trim(),
    public_base_url: String(form.public_base_url ?? '').trim(),
  };
  const secret = String(secretAccessKey ?? '').trim();
  const hasSavedSecret = publicStorageHasSavedSecret(
    secretConfigured,
    secretAccessKey,
    secretDirty
  );
  if (secret) {
    payload.secret_access_key = secret;
  } else if (secretDirty || !hasSavedSecret) {
    payload.secret_access_key = '';
  }
  return payload;
}

/** Whether the current form has enough to run test connection. */
export function canTestPublicStorageConnection(
  form,
  secretAccessKey,
  secretConfigured,
  secretDirty = false
) {
  const endpoint = String(form.endpoint_url ?? '').trim();
  const bucket = String(form.bucket ?? '').trim();
  const baseUrl = String(form.public_base_url ?? '').trim();
  if (!endpoint || !bucket || !baseUrl) return false;

  const accessKey = String(form.access_key_id ?? '').trim();
  const secret = String(secretAccessKey ?? '').trim();
  const hasSavedSecret = publicStorageHasSavedSecret(
    secretConfigured,
    secretAccessKey,
    secretDirty
  );
  const hasExplicit = Boolean(accessKey && (secret || hasSavedSecret));
  const hasIam = !accessKey && !secret && !hasSavedSecret;
  return hasExplicit || hasIam;
}
