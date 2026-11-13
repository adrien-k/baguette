/**
 * Env-gating for live agent-SDK tests. Kept free of Feathers/SDK imports so unit
 * tests can cover skip conditions without booting the app.
 */
import { ANTHROPIC_AUTH_TOKEN_ENV } from '../../shared/agent-config-api-key-env.js';
import { MOCK_STANDARD_MODEL_ID } from '../../shared/mock-agent-sdk.js';

export const DEFAULT_LIVE_TIMEOUT_MS = 180_000;

function trimEnv(name) {
  const raw = process.env[name];
  if (raw == null) return '';
  return String(raw).trim();
}

function parseTimeoutMs() {
  const raw = trimEnv('SDK_TESTS_TIMEOUT_MS');
  if (!raw) return DEFAULT_LIVE_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIVE_TIMEOUT_MS;
}

function truthyFlag(value) {
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * @param {'claude' | 'cursor' | 'pi' | 'mock'} sdk
 * @returns {{
 *   sdk: string,
 *   enabled: boolean,
 *   apiKey: string | null,
 *   apiKeyEnvVar: string | undefined,
 *   apiUrl: string | null,
 *   model: string,
 *   modelParams: string | null,
 *   timeoutMs: number,
 * }}
 */
export function readLiveSdkEnv(sdk) {
  const timeoutMs = parseTimeoutMs();
  if (sdk === 'mock') {
    return {
      sdk,
      enabled: truthyFlag(process.env.SDK_TESTS_MOCK),
      apiKey: null,
      apiKeyEnvVar: undefined,
      apiUrl: null,
      model: MOCK_STANDARD_MODEL_ID,
      modelParams: null,
      timeoutMs,
    };
  }

  const prefix = `SDK_TESTS_${String(sdk).toUpperCase()}`;
  const apiKey = trimEnv(`${prefix}_API_KEY`);
  const authToken = sdk === 'claude' ? trimEnv(`${prefix}_AUTH_TOKEN`) : '';
  const model = trimEnv(`${prefix}_MODEL`);
  const apiUrl = sdk === 'claude' ? trimEnv(`${prefix}_API_URL`) || null : null;
  const modelParamsRaw = trimEnv(`${prefix}_MODEL_PARAMS`);
  const piEnvVar = sdk === 'pi' ? trimEnv(`${prefix}_API_KEY_ENV_VAR`) : '';
  const secret = apiKey || authToken;
  const usingAuthToken = sdk === 'claude' && !apiKey && Boolean(authToken);

  return {
    sdk,
    enabled: Boolean(secret && model),
    apiKey: secret || null,
    apiKeyEnvVar: usingAuthToken ? ANTHROPIC_AUTH_TOKEN_ENV : piEnvVar || undefined,
    apiUrl,
    model,
    modelParams: modelParamsRaw || (sdk === 'cursor' ? '[]' : null),
    timeoutMs,
  };
}

/** Vitest timeout for a full live suite (listModels, connectivity, builder, reviewer). */
export function liveSdkSuiteTimeoutMs(env, { includeReviewer = true } = {}) {
  const turns = includeReviewer ? 2 : 1;
  return env.timeoutMs * turns + 120_000;
}
