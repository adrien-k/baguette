import { z } from 'zod';
import {
  SUBAGENT_DEFAULT_ANY,
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_PRESET,
} from '../../../../shared/subagent-default-mode.js';

const MODEL_PARAMS_FIELD = z
  .array(z.object({ id: z.string(), value: z.string() }))
  .optional()
  .describe('Optional model variant params from ListModels, as { id, value } pairs.');

/**
 * Model arguments exposed on CreateSession, StartSubagent, and loop tools.
 * With `patch` the fields are all optional and fit a patch schema (UpdateLoop),
 * where nothing should be required and an unrelated patch must not be blocked.
 * @param {string} mode
 * @param {{ patch?: boolean }} [opts]
 */
export function agentCreatedModelSchemaFields(mode, { patch = false } = {}) {
  if (mode === SUBAGENT_DEFAULT_ANY) {
    return {
      preset_model_id: z
        .number()
        .int()
        .optional()
        .describe(
          'Preset id from ListPresetModels. Pass this or agent_config_id and model, not both.'
        ),
      agent_config_id: z
        .number()
        .int()
        .optional()
        .describe(
          'Agent configuration id. Required with model when preset_model_id is omitted. ListModels lists models for a configuration.'
        ),
      model: z
        .string()
        .optional()
        .describe(
          'Model id from ListModels for agent_config_id. Required with agent_config_id when preset_model_id is omitted.'
        ),
      model_params: MODEL_PARAMS_FIELD,
    };
  }
  if (mode === SUBAGENT_DEFAULT_PRESET) {
    if (patch) {
      return {
        preset_model_id: z
          .number()
          .int()
          .optional()
          .describe(
            'Optional preset id from ListPresetModels. Pass it only when changing the loop model.'
          ),
      };
    }
    return {
      preset_model_id: z
        .number()
        .int()
        .describe(
          'Preset id from ListPresetModels (required when Agent-created sessions and subagents is Presets only).'
        ),
    };
  }
  return {
    preset_model_id: z
      .number()
      .int()
      .optional()
      .describe(
        'Optional preset id from ListPresetModels. Overrides the configured model for this call.'
      ),
  };
}

/**
 * Sentence appended to CreateSession, StartSubagent, and loop tool descriptions.
 * @param {string} mode
 * @param {'subagent' | 'session' | 'loop'} kind
 */
export function agentCreatedModelClause(mode, kind) {
  if (mode === SUBAGENT_DEFAULT_ANY) {
    return (
      'Settings → Agent (Agent-created sessions and subagents) is Any preset or model: ' +
      'pass preset_model_id from ListPresetModels, or agent_config_id and model from ListModels (optional model_params).'
    );
  }
  if (mode === SUBAGENT_DEFAULT_PRESET) {
    return (
      'Settings → Agent (Agent-created sessions and subagents) is Presets only: ' +
      'pass preset_model_id from ListPresetModels.'
    );
  }
  if (mode === SUBAGENT_DEFAULT_CONFIG) {
    return (
      'Model follows Settings → Agent (Agent-created sessions and subagents): the fixed model. ' +
      'Pass preset_model_id from ListPresetModels to override this call.'
    );
  }
  if (kind === 'subagent') {
    return (
      'Model follows Settings → Agent (Agent-created sessions and subagents): ' +
      'inherit the session primary builder model. ' +
      'Pass preset_model_id from ListPresetModels to override this call.'
    );
  }
  if (kind === 'loop') {
    return (
      'Model follows Settings → Agent (Agent-created sessions and subagents): ' +
      'loops use the builder default. ' +
      'Pass preset_model_id from ListPresetModels to override.'
    );
  }
  return (
    'Model follows Settings → Agent (Agent-created sessions and subagents): ' +
    'new sessions use the builder default. ' +
    'Pass preset_model_id from ListPresetModels to override this call.'
  );
}
