import { BadRequest, NotFound } from '@feathersjs/errors';
import { coerceModelParams } from '../../shared/agent-session-defaults.js';
import { parseAgentDefaultModelJson } from '../../shared/agent-default-model.js';
import {
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_PRESET,
  normalizeSubagentDefaultMode,
} from '../../shared/subagent-default-mode.js';
import { getPrimaryBuilderAgent } from './agents-db.js';
import {
  loadOwnedAgentConfig,
  parseSessionModelId,
  resolveEffectiveSubagentDefaultSettings,
  resolveExplicitBuilderDefaults,
} from './agent-config-resolver.js';

export const MCP_BUILDER_MODEL_SETTINGS_ERROR =
  'Configure a default agent configuration and model under Settings → Agent (Session defaults), or add a preset model there and pass its id with preset_model_id.';

export const MCP_SUBAGENT_PRESET_REQUIRED_ERROR =
  'Subagent default is Preset: pass preset_model_id on StartBuilderAgent (use ListPresetModels to choose one for the task).';

const MCP_SUBAGENT_CONFIG_SETTINGS_ERROR =
  'Configure subagent default configuration and model under Settings → Agent, or set subagent default to Inherit from session.';

async function resolvePresetModel(db, userId, preset_model_id) {
  const preset = await db('agent_model_presets')
    .where({ id: preset_model_id, user_id: userId })
    .first();
  if (!preset) throw new NotFound('Preset model not found');
  const config = await loadOwnedAgentConfig(db, preset.agent_config_id, userId);
  return {
    agent_config_id: preset.agent_config_id,
    agent_sdk: config.sdk,
    model: preset.model,
    model_params: coerceModelParams(preset.model_params),
  };
}

/**
 * Resolve builder model fields for MCP send/start/create tools.
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {{ preset_model_id?: number | null, repo_id?: number | null }} opts
 */
export async function resolveMcpBuilderModel(db, userId, { preset_model_id, repo_id } = {}) {
  if (preset_model_id != null) {
    return resolvePresetModel(db, userId, preset_model_id);
  }

  const defaults = await resolveExplicitBuilderDefaults(db, userId, repo_id ?? null);
  if (!defaults) {
    throw new BadRequest(MCP_BUILDER_MODEL_SETTINGS_ERROR);
  }
  return defaults;
}

/**
 * Resolve model fields for MCP/UI StartBuilderAgent (subagent defaults + session inherit).
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {{ session_id: number, preset_model_id?: number | null, repo_id?: number | null }} opts
 */
export async function resolveMcpStartBuilderModel(
  db,
  userId,
  { session_id, preset_model_id, repo_id } = {}
) {
  const settings = await resolveEffectiveSubagentDefaultSettings(db, userId, repo_id ?? null);
  const mode = normalizeSubagentDefaultMode(settings.mode);

  if (mode === SUBAGENT_DEFAULT_PRESET) {
    if (preset_model_id == null) {
      throw new BadRequest(MCP_SUBAGENT_PRESET_REQUIRED_ERROR);
    }
    return resolvePresetModel(db, userId, preset_model_id);
  }

  if (mode === SUBAGENT_DEFAULT_CONFIG) {
    const configId = settings.config_id;
    if (!configId) {
      throw new BadRequest(MCP_SUBAGENT_CONFIG_SETTINGS_ERROR);
    }
    const config = await loadOwnedAgentConfig(db, configId, userId);
    const { model, model_params } = parseAgentDefaultModelJson(settings.model_json);
    if (!model) {
      throw new BadRequest(MCP_SUBAGENT_CONFIG_SETTINGS_ERROR);
    }
    return {
      agent_config_id: configId,
      agent_sdk: config.sdk,
      model,
      model_params: coerceModelParams(model_params),
    };
  }

  const primary = await getPrimaryBuilderAgent(db, session_id);
  if (!primary?.agent_config_id || !primary.model) {
    throw new BadRequest('Session has no primary builder model to inherit for subagents.');
  }
  return {
    agent_config_id: primary.agent_config_id,
    agent_sdk: primary.agent_sdk,
    model: parseSessionModelId(primary.model),
    model_params: coerceModelParams(primary.model_params),
  };
}
