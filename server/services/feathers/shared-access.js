import { NotFound } from 'feathers/errors';
import {
  LIST_SCOPE_ALL,
  LIST_SCOPE_SHARED,
  normalizeListScope,
  ownerPublicFields,
} from '../../../shared/session-sharing.js';

function recordsFromResult(result) {
  if (!result) return [];
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result)) return result;
  return [result];
}

function writeRecordsToResult(context, records) {
  const result = context.result;
  if (Array.isArray(result?.data)) context.result = { ...result, data: records };
  else if (Array.isArray(result)) context.result = records;
  else context.result = records[0];
}

export function applyListScope(query, userId, listScope) {
  if (userId == null) return query;
  const scope = normalizeListScope(listScope);
  if (scope === LIST_SCOPE_SHARED) {
    return query.where('is_shared', 1).whereNot('user_id', userId);
  }
  if (scope === LIST_SCOPE_ALL) {
    return applyAccessibleScope(query, userId);
  }
  return query.where('user_id', userId);
}

export function applyAccessibleScope(query, userId) {
  if (userId == null) return query;
  return query.where(function ownerOrShared() {
    this.where('user_id', userId).orWhere('is_shared', 1);
  });
}

/** Strip `list_scope` so Knex does not treat it as a column. */
export function takeListScope(context) {
  const query = context.params.query || {};
  if ('list_scope' in query) {
    context.params.listScope = query.list_scope;
    delete query.list_scope;
  }
  return context;
}

/** Find: `list_scope=mine` (default) or `shared`. Get: owner or shared. Create: unchanged (`scopeByUser`). */
export function scopeByOwnerOrShared(context) {
  const userId = context.params.user?.id;
  if (context.method === 'create') return context;
  if (!userId) return context;

  const query = context.service.createQuery(context.params);
  if (context.method === 'find') {
    const listScope =
      context.params.listScope ??
      context.params.sessionListFilters?.list_scope ??
      context.params.query?.list_scope;
    context.params.knex = applyListScope(query, userId, listScope);
    return context;
  }
  context.params.knex = applyAccessibleScope(query, userId);
  return context;
}

/**
 * External writes require owning the parent session. Collaborators may still
 * find/get (and create messages) on shared sessions via scopeByAccessibleSession.
 * When a row id is present, session_id always comes from that row so a payload
 * cannot spoof ownership by pointing at a session the caller owns.
 */
export async function requireOwnSessionForWrite(context) {
  if (!context.params?.provider) return context;
  const userId = context.params.user?.id;
  if (!userId) return context;

  const db = context.app.get('db');
  let rowId = context.id;
  if (rowId == null && (typeof context.data === 'number' || typeof context.data === 'string')) {
    rowId = context.data;
  }
  let sessionId;
  if (rowId != null) {
    const table = context.service.options?.name;
    if (table) {
      const row = await db(table).where({ id: rowId }).select('session_id').first();
      sessionId = row?.session_id;
    } else if (typeof context.service.getTask === 'function') {
      sessionId = context.service.getTask(rowId)?.session_id;
    }
  } else {
    sessionId = context.data?.session_id;
  }
  if (sessionId == null) throw new NotFound('Session not found');
  const session = await db('sessions').where({ id: sessionId, user_id: userId }).first();
  if (!session) throw new NotFound('Session not found');
  return context;
}

export async function scopeByAccessibleSession(context) {
  if (context.method === 'create') {
    if (!context.data.session_id) {
      throw new Error('session_id is required');
    }
    await context.app
      .service('sessions')
      .get(context.data.session_id, { user: context.params.user });
    return context;
  }

  if (context.method === 'patch') {
    await context.service.get(context.id, { user: context.params.user });
    return context;
  }

  const userId = context.params.user?.id;
  if (!userId) return context;

  const query = context.service.createQuery(context.params);
  context.params.knex = query.whereExists(function sessionAccessible() {
    this.select(1)
      .from('sessions')
      .whereRaw(`sessions.id = ${context.service.fullName}.session_id`)
      .andWhere(function ownerOrShared() {
        this.where('sessions.user_id', userId).orWhere('sessions.is_shared', 1);
      });
  });

  return context;
}

export async function attachOwners(context, userIdField = 'user_id') {
  const records = recordsFromResult(context.result);
  if (!records.length) return context;
  const ids = [...new Set(records.map((row) => row[userIdField]).filter((id) => id != null))];
  if (!ids.length) {
    writeRecordsToResult(
      context,
      records.map((row) => ({ ...row, is_shared: !!row.is_shared, owner: null }))
    );
    return context;
  }
  const users = await context.app
    .get('db')('users')
    .whereIn('id', ids)
    .select('id', 'username', 'avatar_url');
  const byId = new Map(users.map((user) => [user.id, ownerPublicFields(user)]));
  writeRecordsToResult(
    context,
    records.map((row) => ({
      ...row,
      is_shared: !!row.is_shared,
      owner: byId.get(row[userIdField]) ?? null,
    }))
  );
  return context;
}

export async function attachViewerLastViewed(context) {
  const viewerId = context.params.user?.id;
  const records = recordsFromResult(context.result);
  if (!viewerId || !records.length) return context;
  const ids = records.map((row) => row.id).filter(Boolean);
  if (!ids.length) return context;
  const states = await context.app
    .get('db')('session_user_state')
    .where({ user_id: viewerId })
    .whereIn('session_id', ids)
    .select('session_id', 'last_viewed_at');
  const byId = new Map(states.map((row) => [row.session_id, row.last_viewed_at]));
  writeRecordsToResult(
    context,
    records.map((row) => {
      if (byId.has(row.id)) {
        return { ...row, last_viewed_at: byId.get(row.id) ?? null };
      }
      if (String(row.user_id) === String(viewerId)) return row;
      return { ...row, last_viewed_at: null };
    })
  );
  return context;
}

export async function upsertSessionLastViewed(db, { sessionId, userId, lastViewedAt, isOwner }) {
  await db('session_user_state')
    .insert({
      session_id: sessionId,
      user_id: userId,
      last_viewed_at: lastViewedAt,
    })
    .onConflict(['session_id', 'user_id'])
    .merge({ last_viewed_at: lastViewedAt });
  if (isOwner) {
    await db('sessions').where({ id: sessionId }).update({ last_viewed_at: lastViewedAt });
  }
}

export async function handleSessionLastViewedPatch(context) {
  if (!('last_viewed_at' in (context.data || {}))) return context;
  const userId = context.params.user?.id;
  if (!userId) return context;

  const db = context.app.get('db');
  const session = await db('sessions').where({ id: context.id }).first();
  if (!session || (session.user_id !== userId && !session.is_shared)) {
    throw new NotFound('Session not found');
  }
  const isOwner = session.user_id === userId;
  await upsertSessionLastViewed(db, {
    sessionId: session.id,
    userId,
    lastViewedAt: context.data.last_viewed_at,
    isOwner,
  });
  context.params.ownSession = session;
  if (isOwner) return context;

  delete context.data.last_viewed_at;
  if (Object.keys(context.data).length > 0) {
    throw new NotFound('Session not found');
  }
  context.params.skipOwnerPatch = true;
  context.result = session;
  delete context.params.knex;
  return context;
}

export async function attachMessageAuthors(context) {
  const records = recordsFromResult(context.result);
  if (!records.length) return context;
  if (records.every((row) => !row?.id || !row?.session_id)) return context;
  const ids = [...new Set(records.map((row) => row.author_user_id).filter((id) => id != null))];
  if (!ids.length) {
    writeRecordsToResult(
      context,
      records.map((row) => ({ ...row, author: null }))
    );
    return context;
  }
  const users = await context.app
    .get('db')('users')
    .whereIn('id', ids)
    .select('id', 'username', 'avatar_url');
  const byId = new Map(users.map((user) => [user.id, ownerPublicFields(user)]));
  writeRecordsToResult(
    context,
    records.map((row) => ({
      ...row,
      author: row.author_user_id != null ? (byId.get(row.author_user_id) ?? null) : null,
    }))
  );
  return context;
}

export async function loadSessionForPublish(db, sessionId) {
  if (!sessionId) return null;
  return db('sessions').where({ id: sessionId }).select('id', 'user_id', 'is_shared').first();
}

/** After an unshare, SSE still needs to reach collaborators who had the item. */
export function stampWasShared(context) {
  if (!context.params.was_shared) return context;
  const records = recordsFromResult(context.result);
  if (records.length !== 1) return context;
  const row = records[0];
  if (!row || row.is_shared) return context;
  writeRecordsToResult(context, [{ ...row, _was_shared: true }]);
  return context;
}
