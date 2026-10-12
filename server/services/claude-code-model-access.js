import { query } from '@anthropic-ai/claude-agent-sdk';

const SELECTED_MODEL_ISSUE = 'issue with the selected model';
const PROBE_TIMEOUT_MS = 25_000;

/**
 * @param {import('@anthropic-ai/claude-agent-sdk').SDKMessage} message
 */
function messageImpliesModelUnavailable(message) {
  if (message.type === 'assistant' && message.error === 'model_not_found') {
    return true;
  }
  if (message.type === 'result' && message.subtype === 'error') {
    const blob = JSON.stringify(message);
    if (blob.includes(SELECTED_MODEL_ISSUE) || blob.includes('model_not_found')) {
      return true;
    }
  }
  return false;
}

/**
 * Whether Claude Code accepts `modelId` with the given subprocess env.
 * @param {string} modelId — SDK picker id (`value` from supportedModels)
 * @param {Record<string, string>} env
 */
export async function probeClaudeCodeModelAccess(modelId, env) {
  const q = query({
    prompt: 'Reply with exactly: OK',
    options: {
      model: modelId,
      maxTurns: 1,
      env,
      permissionMode: 'acceptEdits',
    },
  });
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    for await (const message of q) {
      if (timeout.aborted) {
        return { ok: false, message: 'Timed out checking model access' };
      }
      if (messageImpliesModelUnavailable(message)) {
        return {
          ok: false,
          message: `There's an issue with the selected model (${modelId}). It may not exist or you may not have access to it.`,
        };
      }
      if (message.type === 'result') {
        return { ok: message.subtype !== 'error' };
      }
    }
    return { ok: true };
  } catch (err) {
    const text = err?.message ?? String(err);
    if (text.includes(SELECTED_MODEL_ISSUE)) {
      return {
        ok: false,
        message: `There's an issue with the selected model (${modelId}). It may not exist or you may not have access to it.`,
      };
    }
    return { ok: false, message: text };
  } finally {
    q.close();
  }
}

/**
 * Split SDK model rows into listable vs rejected (inaccessible) for this credential.
 * @param {Array<{ value?: string }>} sdkModels
 * @param {Record<string, string>} env
 */
export async function partitionClaudeCodeModelsByAccess(sdkModels, env) {
  const accessible = [];
  const rejected = [];
  for (const row of sdkModels ?? []) {
    const id = (row?.value ?? '').trim();
    if (!id) continue;
    const probe = await probeClaudeCodeModelAccess(id, env);
    if (probe.ok) {
      accessible.push(row);
    } else {
      rejected.push({ id, message: probe.message ?? 'Model is not available' });
    }
  }
  return { accessible, rejected };
}
