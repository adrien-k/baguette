import { createPiModelRuntime } from './pi-models.js';
import { resolvePiCredentials } from './pi/pi-config.js';

export const PI_TEST_TIMEOUT_MS = 20_000;

/**
 * @param {object | null | undefined} config — decrypted agent_config (Pi sdk)
 */
export async function runPiConnectivityTest(config) {
  const { apiKey, envVar, providerId } = resolvePiCredentials(config);
  const checks = [];
  if (!apiKey) {
    return {
      ok: false,
      checks: [{ id: 'auth', label: 'API key', ok: false, detail: 'No API key configured' }],
    };
  }

  try {
    const runtime = await createPiModelRuntime(apiKey, envVar);
    const status = await runtime.checkAuth(providerId);
    const authOk = Boolean(status?.ok ?? status?.authenticated ?? status);
    checks.push({
      id: 'connectivity',
      label: 'Connectivity',
      ok: true,
    });
    checks.push({
      id: 'auth',
      label: 'Authentication',
      ok: authOk,
      detail: authOk ? undefined : (status?.message ?? 'Provider rejected the API key'),
    });

    let modelCount = 0;
    try {
      const models = await runtime.getAvailable();
      modelCount = Array.isArray(models) ? models.length : 0;
      checks.push({
        id: 'models',
        label: 'Models',
        ok: modelCount > 0 ? true : null,
        detail: modelCount > 0 ? `${modelCount} model(s) available` : 'No models returned',
      });
    } catch (err) {
      checks.push({
        id: 'models',
        label: 'Models',
        ok: null,
        detail: err?.message ?? 'Could not list models',
      });
    }

    const required = checks.filter((c) => c.ok !== null);
    return {
      ok: required.every((c) => c.ok),
      checks,
    };
  } catch (err) {
    return {
      ok: false,
      checks: [
        {
          id: 'connectivity',
          label: 'Connectivity',
          ok: false,
          detail: err?.message ?? 'Failed to reach provider',
        },
      ],
    };
  }
}
