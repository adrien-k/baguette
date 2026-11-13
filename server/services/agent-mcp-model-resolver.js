import { BadRequest, NotFound } from 'feathers/errors';
import { coerceModelParams } from '../../shared/agent-session-defaults.js';
import { resolveAccountDefaultModel } from '../../shared/agent-default-model.js';
import {
  SUBAGENT_DEFAULT_ANY,
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
import { validateAgentSessionDefaults } from './agent-session-defaults.js';

export const MCP_BUILDER_MODEL_SETTINGS_ERROR =
  'Configure a default agent configuration and model under Settings → Agent (Builder default), or pass preset_model_id from ListPresetModels.';

export const MCP_SUBAGENT_PRESET_REQUIRED_ERROR =
  'Settings → Agent (Agent-created sessions and subagents) is Presets only: pass preset_model_id from ListPresetModels.';

export const MCP_AGENT_CREATED_ANY_REQUIRED_ERROR =
  'Settings → Agent (Agent-created sessions and subagents) is Any preset or model: pass preset_model_id from ListPresetModels, or agent_config_id and model from ListModels.';

export const MCP_AGENT_CREATED_MODEL_NOT_ALLOWED_ERROR =
  'Raw model fields are only allowed when Settings → Agent (Agent-created sessions and subagents) is Any preset or model.';

const MCP_SUBAGENT_CONFIG_SETTINGS_ERROR =
  'Configure a model under Settings → Agent (Agent-created sessions and subagents → Fixed model), or choose another option.';

const MCP_AGENT_CREATED_CHOICE_CONFLICT_ERROR =
  'Pass either preset_model_id or agent_config_id and model, not both.';

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

function hasExplicitModelFields({ agent_config_id, model, model_params }) {
  if (agent_config_id != null) return true;
  if (model != null && String(model).trim() !== '') return true;
  if (model_params != null) return true;
  return false;
}

const MCP_EXPLICIT_MODEL_APP_REQUIRED_ERROR =
  'resolveExplicitModel requires app so the chosen model can be validated against the agent configuration.';

async function resolveExplicitModel(db, userId, { agent_config_id, model, model_params, app }) {
  if (!app) {
    throw new BadRequest(MCP_EXPLICIT_MODEL_APP_REQUIRED_ERROR);
  }
  if (agent_config_id == null || model == null || String(model).trim() === '') {
    throw new BadRequest(MCP_AGENT_CREATED_ANY_REQUIRED_ERROR);
  }
  const config = await loadOwnedAgentConfig(db, agent_config_id, userId);
  let resolvedModel = String(model).trim();
  let resolvedParams = null;
  if (model_params != null) {
    if (Array.isArray(model_params) && model_params.length === 0) {
      resolvedParams = null;
    } else {
      resolvedParams = coerceModelParams(model_params);
      if (!resolvedParams) {
        throw new BadRequest('model_params must be an array of { id, value } strings');
      }
    }
  }
  if (app) {
    const user = await db('users').where({ id: userId }).first();
    const validated = await validateAgentSessionDefaults(
      user,
      {
        agent_sdk: config.sdk,
        model: resolvedModel,
        model_params: resolvedParams,
      },
      { app, agentConfigId: config.id }
    );
    if (validated.model) resolvedModel = validated.model;
    resolvedParams = coerceModelParams(validated.model_params);
  }
  return {
    agent_config_id: config.id,
    agent_sdk: config.sdk,
    model: resolvedModel,
    model_params: resolvedParams,
  };
}

async function resolveConfiguredModel(db, userId, settings) {
  const configId = settings.config_id;
  if (!configId) {
    throw new BadRequest(MCP_SUBAGENT_CONFIG_SETTINGS_ERROR);
  }
  const config = await loadOwnedAgentConfig(db, configId, userId);
  const { model, model_params } = resolveAccountDefaultModel(
    settings.model_json,
    config.default_model
  );
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

/**
 * Shared choice for agent-created sessions, loops, and subagents.
 * Returns null when the caller should apply its inherit fallback.
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {string} mode
 * @param {{ config_id?: number | null, model_json?: string | null }} settings
 * @param {{ preset_model_id?: number | null, agent_config_id?: number | null, model?: string | null, model_params?: unknown, app?: object }} choice `app` is required unless only the inherit fallback applies.
 */
async function resolveAgentCreatedChoice(db, userId, mode, settings, choice) {
  const presetId = choice.preset_model_id ?? null;
  const explicit = hasExplicitModelFields(choice);

  if (mode === SUBAGENT_DEFAULT_ANY) {
    if (presetId != null && explicit) {
      throw new BadRequest(MCP_AGENT_CREATED_CHOICE_CONFLICT_ERROR);
    }
    if (presetId != null) return resolvePresetModel(db, userId, presetId);
    if (explicit) return resolveExplicitModel(db, userId, choice);
    throw new BadRequest(MCP_AGENT_CREATED_ANY_REQUIRED_ERROR);
  }

  if (explicit) {
    throw new BadRequest(MCP_AGENT_CREATED_MODEL_NOT_ALLOWED_ERROR);
  }
  if (presetId != null) return resolvePresetModel(db, userId, presetId);
  if (mode === SUBAGENT_DEFAULT_PRESET) {
    throw new BadRequest(MCP_SUBAGENT_PRESET_REQUIRED_ERROR);
  }
  if (mode === SUBAGENT_DEFAULT_CONFIG) {
    return resolveConfiguredModel(db, userId, settings);
  }
  return null;
}

/**
 * Resolve builder model fields for MCP session and loop tools.
 * `app` is required whenever a preset or raw model fields are passed: the
 * chosen model is validated against the agent configuration. Omitting `app`
 * for a raw model now rejects the call instead of silently skipping validation.
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {{ preset_model_id?: number | null, agent_config_id?: number | null, model?: string | null, model_params?: unknown, repo_id?: number | null, app?: object }} opts
 */
export async function resolveMcpBuilderModel(db, userId, opts = {}) {
  const { preset_model_id, agent_config_id, model, model_params, repo_id, app } = opts;
  const settings = await resolveEffectiveSubagentDefaultSettings(db, userId, repo_id ?? null);
  const mode = normalizeSubagentDefaultMode(settings.mode);
  const chosen = await resolveAgentCreatedChoice(db, userId, mode, settings, {
    preset_model_id,
    agent_config_id,
    model,
    model_params,
    app,
  });
  if (chosen) return chosen;

  const defaults = await resolveExplicitBuilderDefaults(db, userId, repo_id ?? null);
  if (!defaults) {
    throw new BadRequest(MCP_BUILDER_MODEL_SETTINGS_ERROR);
  }
  return defaults;
}

/**
 * Resolve model fields for MCP/UI StartSubagent.
 * `app` is required whenever a preset or raw model fields are passed; see resolveMcpBuilderModel.
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {{ session_id: number, preset_model_id?: number | null, agent_config_id?: number | null, model?: string | null, model_params?: unknown, repo_id?: number | null, app?: object }} opts
 */
export async function resolveMcpStartSubagentModel(db, userId, opts = {}) {
  const { session_id, preset_model_id, agent_config_id, model, model_params, repo_id, app } = opts;
  const settings = await resolveEffectiveSubagentDefaultSettings(db, userId, repo_id ?? null);
  const mode = normalizeSubagentDefaultMode(settings.mode);
  const chosen = await resolveAgentCreatedChoice(db, userId, mode, settings, {
    preset_model_id,
    agent_config_id,
    model,
    model_params,
    app,
  });
  if (chosen) return chosen;

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
