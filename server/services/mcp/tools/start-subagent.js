import { z } from 'zod';
import { normalizeSubagentDefaultMode } from '../../../../shared/subagent-default-mode.js';
import { mcpAwaitTimeoutMinutes } from '../../../../shared/mcp-await-timeout.js';
import {
  agentCreatedModelClause,
  agentCreatedModelSchemaFields,
} from '../lib/agent-created-model-fields.js';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';

function startSubagentBaseDescription() {
  const waitMinutes = mcpAwaitTimeoutMinutes();
  return (
    'Create a subagent (`agent_type` subagent) in a session and run its initial prompt. ' +
    `Default attach: true waits until the turn finishes (up to ${waitMinutes} minutes per wait). On timeout the subagent is NOT cancelled — the wait is virtually detached and the turn keeps running: read its last message (GetSessionMessages) to check progress, then call AwaitSubagent again to continue waiting, or StopSubagent only if it looks stuck for no good reason. ` +
    'attach: false returns immediately — then AwaitSubagent if you stay in this turn, or pass notify_parent: true if you will end your turn while it still runs (Baguette posts the result back as a new message when it finishes). ' +
    'Chat in the Baguette UI is disabled for this agent; send follow-ups via CreateSessionMessage with agent_ref. '
  );
}

function startSubagentDescription(mode) {
  return `${startSubagentBaseDescription()}${agentCreatedModelClause(mode, 'subagent')}`;
}

function startSubagentSchema(mode) {
  return {
    session_id: z.number().int().describe('Target session id'),
    name: z.string().describe('Display name for the new subagent'),
    initial_prompt: z.string().describe('First user message that starts the agent turn'),
    attach: z
      .boolean()
      .optional()
      .describe(
        `If true (default), wait until the initial turn finishes (up to ${mcpAwaitTimeoutMinutes()} minutes; on timeout the subagent keeps running — check progress and AwaitSubagent again). If false, return agent_id/ref immediately.`
      ),
    notify_parent: z
      .boolean()
      .optional()
      .describe(
        'When true, Baguette posts this subagent’s result back to you as a new user message when its turn finishes. Use with attach: false if you will end your turn before the subagent finishes; skip it if you will AwaitSubagent yourself.'
      ),
    ...agentCreatedModelSchemaFields(mode),
  };
}

export function createStartSubagentTool(ctx) {
  const { app, userId, userParams, user } = ctx;
  const mode = normalizeSubagentDefaultMode(user?.subagent_default_mode);

  return {
    name: 'StartSubagent',
    description: startSubagentDescription(mode),
    schema: startSubagentSchema(mode),
    handler: async (args) => {
      const {
        session_id,
        name,
        initial_prompt,
        preset_model_id,
        agent_config_id,
        model,
        model_params,
        attach,
        notify_parent,
      } = args;
      const waitForCompletion = attach !== false;
      const { error } = await requireOwnedSessionById(app, session_id, userId);
      if (error) return fail(error);

      try {
        const parentAgentId = ctx.callerAgent?.id ?? null;
        const result = await app.service('agents').startSubagent(
          {
            session_id,
            name,
            initial_prompt,
            ...(parentAgentId != null ? { parent_agent_id: parentAgentId } : {}),
            ...(preset_model_id != null ? { preset_model_id } : {}),
            ...(agent_config_id != null ? { agent_config_id } : {}),
            ...(model != null ? { model } : {}),
            ...(model_params != null ? { model_params } : {}),
            ...(notify_parent === true ? { notify_parent: true } : {}),
            wait_for_completion: waitForCompletion,
          },
          userParams
        );
        return ok(result);
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
