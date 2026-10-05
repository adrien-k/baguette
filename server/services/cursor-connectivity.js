import { Cursor } from '@cursor/sdk';

export const CURSOR_TEST_TIMEOUT_MS = 20_000;

function timeoutCheck(timeoutMs) {
  return `Timed out after ${Math.round(timeoutMs / 1000)}s`;
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(timeoutCheck(timeoutMs))), timeoutMs)
    ),
  ]);
}

/**
 * Validate a Cursor API key by listing models through the Cursor SDK (the same call the
 * model list uses). No separate endpoint is needed — a successful models list proves
 * connectivity and authentication in one step.
 */
export async function runCursorConnectivityTest({ apiKey } = {}) {
  if (!apiKey) {
    return {
      ok: false,
      models: [],
      checks: [
        {
          id: 'auth',
          label: 'Authentication',
          ok: false,
          detail: 'No Cursor API key configured',
        },
      ],
    };
  }

  const checks = [];
  let sdkModels = null;
  let errorDetail = null;
  try {
    sdkModels = await withTimeout(Cursor.models.list({ apiKey }), CURSOR_TEST_TIMEOUT_MS);
  } catch (err) {
    errorDetail = err?.message ?? 'Request failed';
  }

  const modelIds = (Array.isArray(sdkModels) ? sdkModels : [])
    .filter((m) => typeof m?.id === 'string' && m.id !== '')
    .map((m) => m.id);

  checks.push({
    id: 'auth',
    label: 'Authentication',
    ok: Boolean(sdkModels),
    detail: !sdkModels ? errorDetail : undefined,
  });
  checks.push({
    id: 'models',
    label: 'Models endpoint',
    ok: sdkModels ? (modelIds.length > 0 ? true : null) : null,
    detail: !sdkModels
      ? undefined
      : modelIds.length === 0
        ? 'No models returned for this key.'
        : `${modelIds.length} model${modelIds.length === 1 ? '' : 's'} available`,
  });

  const required = checks.filter((c) => c.ok !== null);
  return { ok: required.every((c) => c.ok), models: modelIds, checks };
}
