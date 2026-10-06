/** SQLite bind-parameter budget (default limit 999; stay conservative). */
export const SQLITE_BIND_CHUNK = 400;

/**
 * All session_messages in session order — one table scan instead of per-session SELECTs.
 * @param {import('knex').Knex} knex
 * @param {(sessionId: number, rows: object[]) => void | Promise<void>} onSession
 */
export async function forEachSessionMessageGroup(knex, onSession) {
  const allRows = await knex('session_messages')
    .select('*')
    .orderBy([
      { column: 'session_id', order: 'asc' },
      { column: 'id', order: 'asc' },
    ]);

  let sessionId = null;
  let group = [];
  for (const row of allRows) {
    if (sessionId !== null && row.session_id !== sessionId) {
      await onSession(sessionId, group);
      group = [];
    }
    sessionId = row.session_id;
    group.push(row);
  }
  if (sessionId !== null && group.length > 0) {
    await onSession(sessionId, group);
  }
}

/** @param {Record<string, unknown>} row @param {Record<string, unknown>} patch */
export function rowPatchIsNoop(row, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const current = row[key];
    if (key === 'turn_id') {
      if ((current ?? null) === (value ?? null)) continue;
      return false;
    }
    if (current !== value) return false;
  }
  return true;
}

/**
 * @param {import('knex').Knex} knex
 * @param {number[]} ids
 * @param {import('knex').Knex.Transaction} [trx]
 */
export async function deleteMessageRowsById(knex, ids, trx) {
  if (!ids.length) return;
  const q = trx ?? knex;
  for (let i = 0; i < ids.length; i += SQLITE_BIND_CHUNK) {
    await q('session_messages')
      .whereIn('id', ids.slice(i, i + SQLITE_BIND_CHUNK))
      .delete();
  }
}

/**
 * @param {import('knex').Knex} knex
 * @param {{ id: number, patch: Record<string, unknown> }[]} patches
 * @param {import('knex').Knex.Transaction} [trx]
 */
export async function patchMessageRows(knex, patches, trx) {
  if (!patches.length) return;
  const q = trx ?? knex;
  for (const { id, patch } of patches) {
    await q('session_messages').where({ id }).update(patch);
  }
}

/**
 * @param {import('knex').Knex} knex
 * @param {{
 *   deleteIds?: number[];
 *   patches?: { id: number, patch: Record<string, unknown> }[];
 *   sessionId?: number;
 *   currentTurnId?: number;
 * }} writes
 */
export async function applySessionMessageWrites(knex, writes) {
  const deleteIds = writes.deleteIds ?? [];
  const patches = writes.patches ?? [];
  const hasSessionTurn =
    writes.sessionId != null && writes.currentTurnId != null && writes.currentTurnId > 0;
  if (!deleteIds.length && !patches.length && !hasSessionTurn) return;

  await knex.transaction(async (trx) => {
    await deleteMessageRowsById(knex, deleteIds, trx);
    await patchMessageRows(knex, patches, trx);
    if (hasSessionTurn) {
      await trx('sessions')
        .where({ id: writes.sessionId })
        .update({ current_turn_id: writes.currentTurnId });
    }
  });
}
