import { probePiProviderModelCatalog } from '../lib/pi-provider-model-probe.js';
import { createPiModelRuntime } from './pi-models.js';
import { resolvePiCredentials } from './pi/pi-config.js';

/**
 * @param {Error & { status?: number }} err
 * @returns {{ ok: boolean, checks: Array<{ id: string, label: string, ok: boolean | null, detail?: string }> }}
 */
function piConnectivityFailureFromError(err) {
  const status = err?.status;
  if (status === 401 || status === 403) {
    return {
      ok: false,
      checks: [
        { id: 'connectivity', label: 'Connectivity', ok: true },
        {
          id: 'auth',
          label: 'Authentication',
          ok: false,
          detail: err?.message ?? 'Provider rejected the API key',
        },
      ],
    };
  }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return {
      ok: false,
      checks: [
        {
          id: 'connectivity',
          label: 'Connectivity',
          ok: false,
          detail: err?.message ?? 'Timed out reaching provider',
        },
      ],
    };
  }
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

/**
 * @param {object | null | undefined} config — decrypted agent_config (Pi sdk)
 */
export async function runPiConnectivityTest(config) {
  const { apiKey, envVar, providerId } = resolvePiCredentials(config);
  if (!apiKey) {
    return {
      ok: false,
      checks: [{ id: 'auth', label: 'API key', ok: false, detail: 'No API key configured' }],
    };
  }

  try {
    const runtime = await createPiModelRuntime(apiKey, envVar);
    const { modelCount } = await probePiProviderModelCatalog({
      apiKey,
      envVar,
      providerId,
      config,
      runtime,
    });

    const checks = [
      { id: 'connectivity', label: 'Connectivity', ok: true },
      { id: 'auth', label: 'Authentication', ok: true },
      {
        id: 'models',
        label: 'Models',
        ok: modelCount > 0 ? true : null,
        detail: modelCount > 0 ? `${modelCount} model(s) available` : 'No models returned',
      },
    ];
    const required = checks.filter((c) => c.ok !== null);
    return { ok: required.every((c) => c.ok), checks };
  } catch (err) {
    return piConnectivityFailureFromError(err);
  }
}
