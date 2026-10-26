import { BadRequest } from 'feathers/errors';
import {
  parseAgentDefaultModelJson,
  stringifyAgentDefaultModel,
} from '../../shared/agent-default-model.js';
import { loadOwnedAgentConfig } from './agent-config-resolver.js';
import { validateAgentSessionDefaults } from './agent-session-defaults.js';
import {
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_INHERIT,
  SUBAGENT_DEFAULT_MODE_VALUES,
  SUBAGENT_DEFAULT_PRESET,
  normalizeSubagentDefaultMode,
} from '../../shared/subagent-default-mode.js';

const DEFAULT_PATCH_KEYS = [
  'agent_default_config_id',
  'agent_default_model',
  'reviewer_default_config_id',
  'reviewer_default_model',
  'subagent_default_mode',
  'subagent_default_config_id',
  'subagent_default_model',
];

async function normalizeModelPatch(raw, configId, user, app) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    parsed = parseAgentDefaultModelJson(raw);
  } else if (raw && typeof raw === 'object') {
    parsed = {
      model: raw.model ?? null,
      model_params: raw.model_params ?? null,
    };
  } else {
    throw new BadRequest('agent_default_model must be an object or JSON string');
  }
  if (!parsed.model && !parsed.model_params?.length) return null;
  if (!configId) {
    throw new BadRequest('agent_default_config_id is required when setting a default model');
  }
  const config = await loadOwnedAgentConfig(app.get('db'), configId, user.id);
  await validateAgentSessionDefaults(
    user,
    {
      agent_sdk: config.sdk,
      model: parsed.model,
      model_params: parsed.model_params,
    },
    { app, agentConfigId: configId }
  );
  return stringifyAgentDefaultModel(parsed);
}

async function normalizeReviewerModelPatch(raw, configId, user, app) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    parsed = parseAgentDefaultModelJson(raw);
  } else if (raw && typeof raw === 'object') {
    parsed = {
      model: raw.model ?? null,
      model_params: raw.model_params ?? null,
    };
  } else {
    throw new BadRequest('reviewer_default_model must be an object or JSON string');
  }
  if (!parsed.model && !parsed.model_params?.length) return null;
  if (!configId) {
    throw new BadRequest(
      'reviewer_default_config_id is required when setting a reviewer default model'
    );
  }
  const config = await loadOwnedAgentConfig(app.get('db'), configId, user.id);
  await validateAgentSessionDefaults(
    user,
    {
      agent_sdk: config.sdk,
      model: parsed.model,
      model_params: parsed.model_params,
    },
    { app, agentConfigId: configId }
  );
  return stringifyAgentDefaultModel(parsed);
}

async function normalizeAgentDefaultsPatch(context) {
  const data = context.data;
  const touched = DEFAULT_PATCH_KEYS.some((k) => data[k] !== undefined);
  if (!touched) return context;

  const user = context.params.user;
  if (!user?.id) throw new BadRequest('Not authenticated');

  const existing = await context.service.get(context.id, {
    ...context.params,
    provider: undefined,
  });

  let agentConfigId =
    data.agent_default_config_id !== undefined
      ? data.agent_default_config_id == null
        ? null
        : Number(data.agent_default_config_id)
      : existing.agent_default_config_id;
  let reviewerConfigId =
    data.reviewer_default_config_id !== undefined
      ? data.reviewer_default_config_id == null
        ? null
        : Number(data.reviewer_default_config_id)
      : existing.reviewer_default_config_id;

  if (data.agent_default_config_id !== undefined && agentConfigId != null) {
    await loadOwnedAgentConfig(context.app.get('db'), agentConfigId, user.id);
  }
  if (data.reviewer_default_config_id !== undefined && reviewerConfigId != null) {
    await loadOwnedAgentConfig(context.app.get('db'), reviewerConfigId, user.id);
  }

  if (data.agent_default_config_id === null) {
    data.agent_default_model = null;
  }
  if (data.reviewer_default_config_id === null) {
    data.reviewer_default_model = null;
  }

  if (data.subagent_default_mode !== undefined) {
    if (data.subagent_default_mode == null || data.subagent_default_mode === '') {
      data.subagent_default_mode = SUBAGENT_DEFAULT_INHERIT;
    } else {
      const mode = normalizeSubagentDefaultMode(data.subagent_default_mode);
      if (!SUBAGENT_DEFAULT_MODE_VALUES.includes(mode)) {
        throw new BadRequest('subagent_default_mode must be inherit, config, or preset');
      }
      data.subagent_default_mode = mode;
    }
  }

  let subagentConfigId =
    data.subagent_default_config_id !== undefined
      ? data.subagent_default_config_id == null
        ? null
        : Number(data.subagent_default_config_id)
      : existing.subagent_default_config_id;

  const subagentMode = normalizeSubagentDefaultMode(
    data.subagent_default_mode !== undefined
      ? data.subagent_default_mode
      : existing.subagent_default_mode
  );

  if (subagentMode === SUBAGENT_DEFAULT_INHERIT || subagentMode === SUBAGENT_DEFAULT_PRESET) {
    if (data.subagent_default_mode !== undefined) {
      data.subagent_default_config_id = null;
      data.subagent_default_model = null;
    }
    subagentConfigId = null;
  } else if (data.subagent_default_config_id !== undefined && subagentConfigId != null) {
    await loadOwnedAgentConfig(context.app.get('db'), subagentConfigId, user.id);
  }

  if (data.subagent_default_model !== undefined && subagentMode === SUBAGENT_DEFAULT_CONFIG) {
    data.subagent_default_model = await normalizeModelPatch(
      data.subagent_default_model,
      subagentConfigId,
      user,
      context.app
    );
  }

  if (data.subagent_default_config_id !== undefined) {
    data.subagent_default_config_id = subagentConfigId;
  }

  if (data.agent_default_model !== undefined) {
    data.agent_default_model = await normalizeModelPatch(
      data.agent_default_model,
      agentConfigId,
      user,
      context.app
    );
  }
  if (data.reviewer_default_model !== undefined) {
    data.reviewer_default_model = await normalizeReviewerModelPatch(
      data.reviewer_default_model,
      reviewerConfigId,
      user,
      context.app
    );
  }

  if (data.agent_default_config_id !== undefined) {
    data.agent_default_config_id = agentConfigId;
  }
  if (data.reviewer_default_config_id !== undefined) {
    data.reviewer_default_config_id = reviewerConfigId;
  }

  return context;
}

export async function normalizeUserAgentDefaultsPatch(context) {
  return normalizeAgentDefaultsPatch(context);
}
