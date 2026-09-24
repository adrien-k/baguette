import { z } from 'zod';
import { sliceByteRange, validateLogByteRange } from './mcp-pagination.js';
import { ok, fail } from './baguette-mcp-tool-result.js';
import { packSessionMessagesForMcp } from './baguette-mcp-payload.js';

const SESSION_LIST_COLUMNS = [
  'id',
  'short_id',
  'label',
  'status',
  'repo_id',
  'repo_full_name',
  'base_branch',
  'created_branch',
  'remote_branch',
  'agent_sdk',
  'model',
  'loop_id',
  'pr_url',
  'pr_number',
  'created_at',
  'updated_at',
  'archived_at',
];

async function requireSession(app, sessionId, userId) {
  try {
    return await app.service('sessions').get(sessionId, { user: { id: userId } });
  } catch {
    return null;
  }
}

function applySessionSearchFilters(query, filters, userId) {
  query.where('sessions.user_id', userId);
  if (!filters.include_archived) query.whereNull('sessions.archived_at');
  if (filters.repo_id != null) query.where('sessions.repo_id', filters.repo_id);
  if (filters.base_branch) query.where('sessions.base_branch', filters.base_branch);
  if (filters.target_branch) {
    query.where((q) => {
      q.where('sessions.created_branch', filters.target_branch).orWhere(
        'sessions.remote_branch',
        filters.target_branch
      );
    });
  }
  if (filters.loop_id != null) query.where('sessions.loop_id', filters.loop_id);
  if (filters.created_after) query.where('sessions.created_at', '>=', filters.created_after);
  if (filters.created_before) query.where('sessions.created_at', '<=', filters.created_before);
  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    query.where((q) => {
      q.where('sessions.label', 'like', term).orWhere('sessions.initial_prompt', 'like', term);
    });
  }
  return query;
}

function summarizeAssistantMessage(row) {
  if (!row) return null;
  let parsed;
  try {
    parsed = JSON.parse(row.message_json);
  } catch {
    parsed = null;
  }
  return {
    id: row.id,
    type: row.type,
    subtype: row.subtype ?? null,
    created_at: row.created_at,
    message: parsed?.message ?? null,
    message_json: row.message_json,
  };
}

export function buildBaguetteSessionMcpTools(user, app) {
  const userId = user.id;

  return [
    {
      name: 'SearchSessions',
      description:
        'Search your sessions with optional filters. Matches label and initial_prompt for `q`. `target_branch` matches created_branch or remote_branch.',
      schema: {
        repo_id: z.number().int().optional().describe('Filter by repository id from ListRepos'),
        q: z.string().optional().describe('Search in session label and initial_prompt'),
        base_branch: z.string().optional(),
        target_branch: z.string().optional().describe('Matches created_branch or remote_branch'),
        created_after: z
          .string()
          .optional()
          .describe('ISO timestamp — sessions created at or after'),
        created_before: z
          .string()
          .optional()
          .describe('ISO timestamp — sessions created at or before'),
        loop_id: z.number().int().optional().describe('Filter sessions spawned by this loop'),
        include_archived: z
          .boolean()
          .optional()
          .describe('Include archived sessions (default false)'),
        limit: z.number().int().min(1).max(100).optional().describe('Max results (default 50)'),
      },
      handler: async (args) => {
        if (args.repo_id != null) {
          const db = app.get('db');
          const linked = await db('user_repos')
            .where({ user_id: userId, repo_id: args.repo_id })
            .first();
          if (!linked)
            return fail(`Repository ${args.repo_id} not found or not linked to your account.`);
        }
        const db = app.get('db');
        const limit = args.limit ?? 50;
        let query = db('sessions').select(...SESSION_LIST_COLUMNS);
        query = applySessionSearchFilters(query, args, userId);
        const sessions = await query.orderBy('sessions.created_at', 'desc').limit(limit);
        return ok({ sessions, count: sessions.length });
      },
    },

    {
      name: 'GetSession',
      description:
        'Get one session with details, message count, initial_prompt, and the most recent assistant message.',
      schema: {
        session_id: z.number().int().describe('Session id'),
      },
      handler: async ({ session_id }) => {
        const session = await requireSession(app, session_id, userId);
        if (!session) return fail('Session not found');

        const db = app.get('db');
        const { count } = await db('session_messages')
          .where({ session_id })
          .count('* as count')
          .first();
        const messageCount = Number(count ?? 0);

        const lastAssistant = await db('session_messages')
          .where({ session_id })
          .whereIn('type', ['assistant'])
          .orderBy('id', 'desc')
          .first();

        return ok({
          session,
          message_count: messageCount,
          initial_prompt: session.initial_prompt ?? null,
          last_assistant_message: summarizeAssistantMessage(lastAssistant),
        });
      },
    },

    {
      name: 'GetSessionMessages',
      description:
        'List session messages (paginated). Response JSON is capped at 5000 bytes; oversized bodies are truncated with a hint to use GetSessionMessage. Pass afterMessage with the last id from the previous page.',
      schema: {
        session_id: z.number().int(),
        types: z
          .array(z.enum(['user', 'assistant']))
          .optional()
          .describe('Filter by message types (default: user and assistant)'),
        afterMessage: z
          .number()
          .int()
          .optional()
          .describe('Return messages with id greater than this message id'),
      },
      handler: async ({ session_id, types, afterMessage }) => {
        const session = await requireSession(app, session_id, userId);
        if (!session) return fail('Session not found');

        const typeFilter = types?.length ? types : ['user', 'assistant'];
        const db = app.get('db');
        let query = db('session_messages')
          .where({ session_id })
          .whereIn('type', typeFilter)
          .orderBy('id', 'asc');

        if (afterMessage != null) query = query.where('id', '>', afterMessage);

        const rows = await query.limit(200);
        const packed = packSessionMessagesForMcp(rows, { afterMessage: afterMessage ?? null });
        return ok({ session_id, ...packed });
      },
    },

    {
      name: 'GetSessionMessage',
      description:
        'Read a single message body (message_json) with optional byte range — same semantics as ReadTaskOutput / PrWorkflowLogs (default last 5000 bytes).',
      schema: {
        session_id: z.number().int(),
        message_id: z.number().int(),
        startByte: z.number().optional(),
        endByte: z.number().optional(),
      },
      handler: async ({ session_id, message_id, startByte, endByte }) => {
        const validationError = validateLogByteRange({ startByte, endByte });
        if (validationError) return fail(validationError);

        const session = await requireSession(app, session_id, userId);
        if (!session) return fail('Session not found');

        const db = app.get('db');
        const row = await db('session_messages').where({ id: message_id, session_id }).first();
        if (!row) return fail('Message not found');

        try {
          const {
            log,
            totalBytes,
            startByte: actualStart,
            endByte: actualEnd,
          } = sliceByteRange(row.message_json ?? '', { startByte, endByte });
          return ok({
            session_id,
            message_id,
            type: row.type,
            subtype: row.subtype ?? null,
            created_at: row.created_at,
            totalBytes,
            startByte: actualStart,
            endByte: actualEnd,
            message_json: log,
          });
        } catch (err) {
          return fail(err.message);
        }
      },
    },
  ];
}
