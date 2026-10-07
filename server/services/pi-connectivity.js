import { createPiModelRuntime } from './pi-models.js';
import { resolvePiCredentials } from './pi/pi-config.js';

export const PI_TEST_TIMEOUT_MS = 20_000;

/**
 * @param {object} user
 * @param {{ apiKey: string | null, envVar: string, providerId: string }} effective
 */
export async function runPiConnectivityTest(user, effective) {
  const checks = [];
  if (!effective.apiKey) {
    return {
      ok: false,
      effective: { pi_api_key_configured: false, pi_api_key_env_var: effective.envVar },
      checks: [{ id: 'auth', label: 'API key', ok: false, detail: 'No API key configured' }],
    };
  }

  try {
    const runtime = await createPiModelRuntime(effective.apiKey, effective.envVar);
    const status = await runtime.checkAuth(effective.providerId);
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
      effective: {
        pi_api_key_configured: true,
        pi_api_key_env_var: effective.envVar,
        provider_id: effective.providerId,
      },
      checks,
    };
  } catch (err) {
    return {
      ok: false,
      effective: {
        pi_api_key_configured: true,
        pi_api_key_env_var: effective.envVar,
      },
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

export function resolvePiEffectiveForTest(user, repo, overrides = {}) {
  const pick = (override, saved) => (override !== undefined ? override : saved);
  const account = {
    pi_api_key: pick(overrides.pi_api_key, user?.pi_api_key),
    pi_api_key_env_var: pick(overrides.pi_api_key_env_var, user?.pi_api_key_env_var),
  };
  const repoScoped = repo
    ? {
        pi_api_key: pick(overrides.pi_api_key, repo.pi_api_key),
        pi_api_key_env_var: pick(overrides.pi_api_key_env_var, repo.pi_api_key_env_var),
      }
    : null;
  return resolvePiCredentials(account, repoScoped);
}
