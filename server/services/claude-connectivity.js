import { listAnthropicApiModels, probeAnthropicMessages } from '../lib/anthropic-api/models.js';
import { claudeGatewayFields } from '../../shared/agent-config-api-key-env.js';
import { normalizeAnthropicBaseUrl } from './session-env.js';

export const CLAUDE_TEST_TIMEOUT_MS = 20_000;
const CLAUDE_MESSAGES_PROBE_MODEL = 'claude-sonnet-4-5';

function timeoutCheck(timeoutMs) {
  return `Timed out after ${Math.round(timeoutMs / 1000)}s`;
}

/**
 * Two probes against the effective endpoint:
 * 1. GET /v1/models — connectivity + auth + the gateway's model list.
 * 2. POST /v1/messages (max_tokens: 1) — fallback for connectivity/auth when the endpoint
 *    does not implement /v1/models (404).
 *
 * @param {object | null | undefined} config — decrypted agent_config (Claude sdk)
 */
export async function runClaudeConnectivityTest(config) {
  const { apiKey, authToken, baseUrl } = claudeGatewayFields(config);
  const base = normalizeAnthropicBaseUrl(baseUrl) || 'https://api.anthropic.com';
  const checks = [];
  const modelIds = [];

  const apiConfig = { baseUrl: base, apiKey, authToken };

  let modelsRes = null;
  let modelsParsed = null;
  let modelsList = null;
  try {
    modelsList = await listAnthropicApiModels(apiConfig, {
      limit: 100,
      signal: AbortSignal.timeout(CLAUDE_TEST_TIMEOUT_MS),
    });
    modelsRes = { ok: true, status: 200, statusText: 'OK' };
    modelsParsed = { data: modelsList.map((m) => ({ id: m.id, display_name: m.display_name })) };
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return {
        ok: false,
        base_url: base,
        checks: [
          {
            id: 'connectivity',
            label: 'Connectivity',
            ok: false,
            detail: timeoutCheck(CLAUDE_TEST_TIMEOUT_MS),
          },
        ],
      };
    }
    if (typeof err?.status === 'number') {
      modelsRes = { ok: false, status: err.status, statusText: 'Error' };
      const apiErr = err.apiError;
      modelsParsed =
        apiErr && typeof apiErr === 'object' && 'error' in apiErr
          ? apiErr
          : { error: { message: err.message } };
    } else {
      modelsRes = null;
      modelsParsed = null;
    }
    modelsList = null;
  }

  const modelsReached = Boolean(modelsRes);
  const modelsOk = Boolean(modelsRes?.ok);

  // When /v1/models is unavailable or rejected, the messages probe takes over for
  // connectivity and auth.
  const needMessagesProbe = !modelsReached || !modelsOk;
  let messagesRes = null;
  let messagesParsed = null;
  let messagesErrorDetail = null;
  if (needMessagesProbe) {
    try {
      const probe = await probeAnthropicMessages(apiConfig, {
        model: CLAUDE_MESSAGES_PROBE_MODEL,
        signal: AbortSignal.timeout(CLAUDE_TEST_TIMEOUT_MS),
      });
      messagesRes = probe.response;
      messagesParsed = probe.data ?? probe.error;
    } catch (err) {
      messagesErrorDetail =
        err?.name === 'TimeoutError' || err?.name === 'AbortError'
          ? timeoutCheck(CLAUDE_TEST_TIMEOUT_MS)
          : (err?.cause?.code ?? err?.message ?? 'Network error');
    }
  }

  const reached = modelsReached || Boolean(messagesRes);
  if (!reached) {
    return {
      ok: false,
      base_url: base,
      checks: [
        { id: 'connectivity', label: 'Connectivity', ok: false, detail: messagesErrorDetail },
      ],
    };
  }

  // Auth is judged from whichever probe succeeded: a 2xx /v1/models proves the credential,
  // otherwise the messages probe decides (its 404s are model errors, not auth errors).
  const authOk = modelsOk || Boolean(messagesRes?.ok);
  const authStatus = authOk ? null : (modelsRes ?? messagesRes);
  checks.push({
    id: 'connectivity',
    label: 'Connectivity',
    ok: true,
    detail: authOk ? undefined : `${authStatus.status} ${authStatus.statusText}`.trim(),
  });
  checks.push({
    id: 'auth',
    label: 'Authentication',
    ok: authOk,
    detail: !authOk
      ? (modelsParsed?.error?.message ?? messagesParsed?.error?.message ?? 'Unauthorized')
      : undefined,
  });

  if (modelsReached) {
    const list = Array.isArray(modelsParsed?.data) ? modelsParsed.data : [];
    for (const entry of list) {
      const id = entry?.id ?? entry?.name;
      if (typeof id === 'string' && id) modelIds.push(id);
    }
    const unsupported = !modelsOk && [404, 405, 501].includes(modelsRes.status);
    checks.push({
      id: 'models',
      label: 'Models endpoint',
      // Informational only — never gates the overall result (auth/connectivity already do).
      ok: unsupported ? null : modelsOk && modelIds.length > 0 ? true : modelsOk ? false : null,
      detail: !modelsOk
        ? `${modelsRes.status} ${modelsRes.statusText}`.trim()
        : modelIds.length === 0
          ? 'Gateway returned no models — model discovery may not be supported.'
          : `${modelIds.length} model${modelIds.length === 1 ? '' : 's'} listed`,
    });
  } else {
    checks.push({
      id: 'models',
      label: 'Models endpoint',
      ok: null,
      detail: 'Gateway does not expose /v1/models — checked /v1/messages instead',
    });
  }

  const required = checks.filter((c) => c.ok !== null);
  return { ok: required.every((c) => c.ok), base_url: base, models: modelIds, checks };
}
