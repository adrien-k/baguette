/**
 * Model for one agent turn: explicit fields on the message/queue/loop row, else the
 * session default. Creating a message with an explicit model must not patch the session.
 *
 * `model` and `model_params` are always a pair: both set on the row, or both omitted
 * (session defaults applied before the turn runs).
 */

/** Baguette-injected user message (collapsed Baguette block in chat). */
export function isBaguetteUserMessage(parsed) {
  return parsed?.type === 'user' && (parsed.source === 'baguette' || parsed.subtype === 'baguette');
}

/** User-typed chat message (not Baguette-injected, not a tool-result carrier). */
export function isHumanUserMessage(parsed) {
  if (parsed?.type !== 'user') return false;
  if (isBaguetteUserMessage(parsed)) return false;
  const content = parsed.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) return !content.some((b) => b.type === 'tool_result');
  return false;
}

/** User or Baguette-injected message that starts a new agent turn. */
export function isTurnStartingUserMessage(msg) {
  if (msg?.type !== 'user') return false;
  return isHumanUserMessage(msg) || isBaguetteUserMessage(msg);
}

/**
 * Index of the user message that started the latest agent turn, or 0 when none.
 * @param {object[]} messages reconciled session messages in order
 */
export function findLastTurnStartIndex(messages) {
  if (!Array.isArray(messages)) return 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isTurnStartingUserMessage(messages[i])) return i;
  }
  return 0;
}

/** @param {Record<string, unknown>|null|undefined} source */
function readTurnModelPair(source) {
  const hasModel = source?.model != null && String(source.model).trim() !== '';
  const hasParams = source?.model_params != null;
  return {
    hasModel,
    hasParams,
    model: hasModel ? String(source.model).trim() : null,
    modelParams: hasParams ? source.model_params : null,
  };
}

/** @returns {string|null} Error message when the pair is invalid; null when ok. */
export function getTurnModelPairError(source) {
  if (!source) return null;
  const { hasModel, hasParams } = readTurnModelPair(source);
  if (hasModel === hasParams) return null;
  return 'model and model_params must both be set or both omitted (session defaults apply when omitted)';
}

/**
 * Model + params for one turn: explicit snapshot on the row, or the session default.
 */
export function resolveTurnModel(source, session) {
  const pair = readTurnModelPair(source);
  if (pair.hasModel && pair.hasParams) {
    return { model: pair.model, modelParams: pair.modelParams };
  }
  const sessionPair = readTurnModelPair(session);
  return {
    model: sessionPair.model ?? session?.model ?? null,
    modelParams: sessionPair.modelParams ?? session?.model_params ?? null,
  };
}

/** Fields to copy onto messages.create / queued-messages.create (pair only). */
export function turnModelCreateFields(source) {
  const { hasModel, hasParams, model, modelParams } = readTurnModelPair(source);
  if (hasModel && hasParams) {
    return { model, model_params: modelParams };
  }
  return {};
}

/**
 * When a human user message is created without an explicit model snapshot, persist the
 * session default on the row so chat history can show which model ran the turn.
 */
export function attachSessionTurnModelFields(data, session) {
  if (!data || data.type !== 'user') return data;
  const pair = readTurnModelPair(data);
  if (pair.hasModel && pair.hasParams) return data;
  if (pair.hasModel) return data;
  let parsed;
  try {
    parsed = JSON.parse(data.message_json || '{}');
  } catch {
    return data;
  }
  if (!isHumanUserMessage(parsed) && !isBaguetteUserMessage(parsed)) return data;
  const sessionPair = readTurnModelPair(session);
  if (sessionPair.model) data.model = sessionPair.model;
  if (sessionPair.modelParams != null) data.model_params = sessionPair.modelParams;
  return data;
}
