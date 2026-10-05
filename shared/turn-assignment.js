import { isBaguetteUserMessage, isHumanUserMessage } from './turn-model.js';
import { normalizeUserPayloadForStorage } from './session-message-mappers.js';

function parsePayload(messageJson) {
  try {
    return JSON.parse(messageJson || '{}');
  } catch {
    return {};
  }
}

/**
 * @param {object} session
 * @param {object} data - messages.create data
 * @param {{ channel: 'chat' | 'review'; force?: boolean }} opts
 */
export function resolveTurnIdForUserCreate(session, data, opts) {
  const parsed = parsePayload(data.message_json);
  const normalized = normalizeUserPayloadForStorage(parsed);
  const isUserTurn =
    data.type === 'user' && (isHumanUserMessage(normalized) || isBaguetteUserMessage(normalized));
  if (!isUserTurn) return { turnId: data.turn_id ?? null, increment: false };

  const running =
    opts.channel === 'review' ? session.review_status === 'running' : session.status === 'running';

  const activeTurn =
    opts.channel === 'review' ? session.active_review_turn_id : session.active_chat_turn_id;

  const steering = Boolean(opts.force) && isHumanUserMessage(normalized);

  if (running && steering && activeTurn != null) {
    return { turnId: activeTurn, increment: false };
  }

  if (running && !steering && isBaguetteUserMessage(normalized) && activeTurn != null) {
    return { turnId: activeTurn, increment: false };
  }

  const next = (session.current_turn_id ?? 0) + 1;
  return { turnId: next, increment: true, newCurrentTurnId: next };
}

/**
 * Feathers before.create hook helper.
 * @param {'chat' | 'review'} channel
 */
export async function assignTurnOnUserMessageCreate(context, channel) {
  const data = context.data;
  if (!data?.session_id || data.type !== 'user') return context;

  const db = context.app.get('db');
  const session = await db('sessions').where({ id: data.session_id }).first();
  if (!session) return context;

  const { turnId, increment, newCurrentTurnId } = resolveTurnIdForUserCreate(session, data, {
    channel,
    force: context.params._force,
  });

  if (turnId != null) data.turn_id = turnId;
  if (increment && newCurrentTurnId != null) {
    await db('sessions').where({ id: session.id }).update({ current_turn_id: newCurrentTurnId });
  }

  const parsed = parsePayload(data.message_json);
  data.message_json = JSON.stringify(normalizeUserPayloadForStorage(parsed));

  return context;
}
