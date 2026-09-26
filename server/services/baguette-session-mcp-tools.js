import { z } from 'zod';
import { sliceByteRange, validateLogByteRange } from './mcp-pagination.js';
import { ok, fail } from './baguette-mcp-tool-result.js';
import { packSessionMessagesForMcp } from './baguette-mcp-payload.js';
import { isGlobalSession } from '../../shared/session-scope.js';

const SESSION_LIST_COLUMNS = [
  'id',
  'short_id',
  'label',
  'status',
  'repo_id',
  'repo_full_name',
  'is_global',
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
  'last_activity_at',
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
  if (filters.is_global) query.where('sessions.is_global', true);
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

/** Matches `source` / `subtype` checked in client ChatMessage for MCP styling. */
export function buildMcpUserMessageJson(text) {
  return JSON.stringify({
    type: 'user',
    source: 'mcp',
    message: { role: 'user', content: text },
  });
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

function crossSessionPostError() {
  return 'Posting to another session is only allowed from a global Baguette session or external MCP.';
}

function canPostToSession(callerSession, targetSessionId) {
  // External HTTP MCP has no caller session; account token already scopes to the user.
  if (!callerSession) return true;
  if (isGlobalSession(callerSession)) return true;
  return callerSession.id === targetSessionId;
}

/**
 * @param {object} user
 * @param {object} app
 * @param {{ callerSession?: { id: number, is_global?: boolean } | null }} [options]
 *   callerSession — the in-session agent running MCP (omit for external HTTP MCP, which may post to any owned session).
 */
export function buildBaguetteSessionMcpTools(user, app, { callerSession = null } = {}) {
  const userId = user.id;

  return [
    {
      name: 'SearchSessions',
      description:
        'Search your sessions with optional filters. Matches label and initial_prompt for `q`. `target_branch` matches created_branch or remote_branch.',
      schema: {
        repo_id: z.number().int().optional().describe('Filter by repository id from ListRepos'),
        is_global: z.boolean().optional().describe('Filter to global sessions'),
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
        const sessions = await query
          .orderByRaw('CASE WHEN sessions.archived_at IS NOT NULL THEN 1 ELSE 0 END ASC')
          .orderBy('sessions.last_activity_at', 'desc')
          .limit(limit);
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
      name: 'CreateSessionMessage',
      description:
        'IMPORTANT: Do not use this tool unless the user explicitly asks you to send or schedule a message to a session. ' +
        'Send a user message to a session now, or schedule it with send_at (ISO timestamp in the future). ' +
        'Repo session agents may only post to their own session_id; global session agents and external MCP may post to any of your sessions. ' +
        'Immediate sends while the agent is running are queued for the next turn, like the UI Send button.',
      schema: {
        session_id: z.number().int(),
        text: z.string().describe('User message text'),
        send_at: z
          .string()
          .optional()
          .describe('ISO timestamp — deliver at this time instead of sending immediately'),
        force: z
          .boolean()
          .optional()
          .describe(
            'When sending immediately: start a new turn even if the agent is already running'
          ),
      },
      handler: async ({ session_id, text, send_at, force }) => {
        if (!canPostToSession(callerSession, session_id)) {
          return fail(crossSessionPostError());
        }
        const session = await requireSession(app, session_id, userId);
        if (!session) return fail('Session not found');

        const message_json = buildMcpUserMessageJson(text);
        const userParams = { provider: 'rest', user: { id: userId } };

        if (send_at) {
          try {
            const row = await app
              .service('queued-messages')
              .schedule({ session_id, message_json, send_at }, { user: { id: userId } });
            return ok({
              scheduled: true,
              queued_message_id: row.id,
              send_at: row.send_at,
              session_id,
            });
          } catch (err) {
            return fail(err.message);
          }
        }

        try {
          const result = await app.service('messages').create(
            {
              session_id,
              type: 'user',
              subtype: 'mcp',
              message_json,
              ...(force ? { force: true } : {}),
            },
            userParams
          );
          if (result?.queued) {
            return ok({ queued: true, session_id });
          }
          return ok({ message_id: result.id, session_id });
        } catch (err) {
          return fail(err.message);
        }
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
