import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById, buildMcpUserMessageJson } from '../lib/session-resolution.js';
import { getAgentBySessionRef } from '../../agents-db.js';
import { sessionMessageIdentity } from '../../feathers/message-create-fields.js';

export function createCreateSessionMessageTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'CreateSessionMessage',
    description:
      'IMPORTANT: Do not use this tool unless the user explicitly asks you to send or schedule a message to a session. ' +
      'Send a user message to a session now, or schedule it with send_at (ISO timestamp in the future). ' +
      'You may post to any of your sessions (session_id must belong to your account). ' +
      'Immediate sends while the agent is running are queued for the next turn, like the UI Send button. ' +
      'Set force to deliver into the active turn now (steering), same as force-send in chat. ' +
      'Optional agent_ref targets a builder agent; omit to send to the primary builder. ' +
      'Uses that agent’s stored configuration and model (no preset_model_id or other model overrides).',
    schema: {
      session_id: z.number().int().describe('Target session id'),
      text: z.string().trim().min(1).describe('User message text (non-empty)'),
      agent_ref: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Session-relative agent ref; defaults to the primary builder'),
      send_at: z
        .string()
        .optional()
        .describe('ISO timestamp — deliver at this time instead of sending immediately'),
      force: z
        .boolean()
        .optional()
        .describe(
          'When sending immediately while the agent is already running: steer into the active turn instead of queueing for the next turn'
        ),
    },
    handler: async (args) => {
      const { session_id, text, send_at, force, agent_ref } = args;
      const body = String(text ?? '').trim();
      if (!body) return fail('text is required');
      const owned = await requireOwnedSessionById(app, session_id, userId);
      if (owned.error) return fail(owned.error);

      const db = app.get('db');
      let agent;
      if (agent_ref != null) {
        agent = await getAgentBySessionRef(db, session_id, agent_ref);
        if (!agent) return fail('Agent not found');
        if (agent.agent_type !== 'builder' && agent.agent_type !== 'subagent') {
          return fail('Only builder and subagent agents accept messages');
        }
      } else {
        agent = await db('agents').where({ session_id, is_primary: 1 }).first();
        if (!agent) return fail('Agent not found');
      }

      let identity;
      try {
        identity = sessionMessageIdentity(agent);
      } catch (err) {
        return fail(err.message);
      }

      const message_json = buildMcpUserMessageJson(body);
      const userParams = { provider: 'rest', user: { id: userId } };

      if (send_at) {
        try {
          const row = await app
            .service('queued-messages')
            .schedule({ session_id, message_json, send_at, ...identity }, { user: { id: userId } });
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
            ...identity,
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
  };
}
