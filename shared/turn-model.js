/**
 * Model for one agent turn: explicit fields on the message/queue/loop row, else the
 * session default. Creating a message with an explicit model must not patch the session.
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

export function resolveTurnModel(source, session) {
  if (source?.model != null && source.model !== '') {
    return {
      model: source.model,
      modelParams: source.model_params ?? null,
    };
  }
  return {
    model: session?.model ?? null,
    modelParams: session?.model_params ?? null,
  };
}

/** Fields to copy onto messages.create / queued-messages.create. */
export function turnModelCreateFields(source) {
  const fields = {};
  if (source?.model != null && source.model !== '') fields.model = source.model;
  if (source?.model_params != null) fields.model_params = source.model_params;
  return fields;
}

/**
 * When a human user message is created without an explicit model snapshot, persist the
 * session default on the row so chat history can show which model ran the turn.
 */
export function attachSessionTurnModelFields(data, session) {
  if (!data || data.type !== 'user') return data;
  if (data.model != null && data.model !== '') return data;
  let parsed;
  try {
    parsed = JSON.parse(data.message_json || '{}');
  } catch {
    return data;
  }
  if (!isHumanUserMessage(parsed) && !isBaguetteUserMessage(parsed)) return data;
  const { model, modelParams } = resolveTurnModel(data, session);
  if (model) data.model = model;
  if (modelParams != null) data.model_params = modelParams;
  return data;
}
