import { z } from 'zod';
import {
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_PRESET,
  normalizeSubagentDefaultMode,
} from '../../../../shared/subagent-default-mode.js';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';

const BASE_DESCRIPTION =
  'Create a subagent (`agent_type` subagent) in a session, run its initial prompt, and wait for the turn to finish. ' +
  'Chat in the Baguette UI is disabled for this agent; send follow-ups via CreateSessionMessage with agent_ref. ';

function startSubagentDescription(mode) {
  if (mode === SUBAGENT_DEFAULT_PRESET) {
    return (
      BASE_DESCRIPTION +
      'Pass preset_model_id from ListPresetModels (Settings → Agent subagent default is Preset).'
    );
  }
  return (
    BASE_DESCRIPTION +
    'Model follows Settings → Agent subagent default: ' +
    (mode === SUBAGENT_DEFAULT_CONFIG
      ? 'the configured subagent agent configuration and model.'
      : 'inherit the session primary builder configuration and model.')
  );
}

function startSubagentSchema(mode) {
  const base = {
    session_id: z.number().int().describe('Target session id'),
    name: z.string().describe('Display name for the new subagent'),
    initial_prompt: z.string().describe('First user message that starts the agent turn'),
  };
  if (mode === SUBAGENT_DEFAULT_PRESET) {
    return {
      ...base,
      preset_model_id: z
        .number()
        .int()
        .describe('Preset id from ListPresetModels (required when subagent default is Preset).'),
    };
  }
  return base;
}

export function createStartSubagentTool(ctx) {
  const { app, userId, userParams, user } = ctx;
  const mode = normalizeSubagentDefaultMode(user?.subagent_default_mode);

  return {
    name: 'StartSubagent',
    description: startSubagentDescription(mode),
    schema: startSubagentSchema(mode),
    handler: async (args) => {
      const { session_id, name, initial_prompt, preset_model_id } = args;
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
            ...(mode === SUBAGENT_DEFAULT_PRESET && preset_model_id != null
              ? { preset_model_id }
              : {}),
            wait_for_completion: true,
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
