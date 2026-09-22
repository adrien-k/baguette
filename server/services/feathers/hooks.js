import { NotAuthenticated, Forbidden } from '@feathersjs/errors';
import { encrypt, decrypt } from '../../lib/encrypt.js';

export function maskValue(value) {
  if (!value || value.length <= 6) return '••••••';
  return value.slice(0, 3) + '•'.repeat(Math.min(value.length - 6, 10)) + value.slice(-3);
}

/**
 * Before hook factory: encrypts plain field(s) into their encrypted column counterparts.
 * fieldMap: { plainField: 'encrypted_column_name', ... }
 */
export function encryptFields(fieldMap) {
  return (context) => {
    for (const [plain, encrypted] of Object.entries(fieldMap)) {
      if (context.data[plain] !== undefined) {
        context.data[encrypted] = context.data[plain] ? encrypt(context.data[plain]) : null;
        delete context.data[plain];
      }
    }
    return context;
  };
}

/**
 * After hook factory: decrypts encrypted column(s) back to plain fields.
 * When called with a provider (external/socket/REST), values are masked.
 * When called internally (no provider), values are plaintext.
 * fieldMap: { plainField: 'encrypted_column_name', ... }
 */
export function decryptFields(fieldMap) {
  return (context) => {
    const isExternal = !!context.params.provider;
    const processRecord = (record) => {
      for (const [plain, encrypted] of Object.entries(fieldMap)) {
        if (record[encrypted]) {
          try {
            const raw = decrypt(record[encrypted]);
            record[plain] = isExternal ? maskValue(raw) : raw;
          } catch {
            record[plain] = null;
          }
        } else {
          record[plain] = null;
        }
        delete record[encrypted];
      }
      return record;
    };
    if (Array.isArray(context.result)) {
      context.result = context.result.map(processRecord);
    } else if (context.result?.data) {
      context.result.data = context.result.data.map(processRecord);
    } else if (context.result) {
      context.result = processRecord(context.result);
    }
    return context;
  };
}

export async function requireUser(context) {
  if (context.params.provider && !context.params.user?.id) {
    throw new NotAuthenticated('Not authenticated');
  }
  return context;
}

export async function scopeByUser(context) {
  const userId = context.params.user?.id;
  if (context.method === 'create') {
    if (userId) context.data.user_id = userId;
    return context;
  }

  if (!userId) return context;

  const query = context.service.createQuery(context.params);
  context.params.knex = query.where('user_id', userId);
  return context;
}

export async function scopeBySessionUser(context) {
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

  const query = context.service.createQuery(context.params);
  context.params.knex = query.whereExists(function () {
    this.select(1)
      .from('sessions')
      .whereRaw(`sessions.id = ${context.service.fullName}.session_id`)
      .where('sessions.user_id', context.params.user.id);
  });

  return context;
}

/**
 * Strip every field but `fields` from external create/patch payloads.
 * Internal calls (no provider) keep the full payload.
 */
export function only(fields) {
  const allowedFields = new Set(fields);
  return async (context) => {
    // Feathers exposes the transport on params, not on the context itself.
    if (context.params?.provider && (context.method === 'create' || context.method === 'patch')) {
      for (const key in context.data) {
        if (!allowedFields.has(key)) {
          delete context.data[key];
        }
      }
    }
    return context;
  };
}

export async function disableExternal(context) {
  if (context.params?.provider) {
    throw new Forbidden('External access forbidden');
  }
  return context;
}
