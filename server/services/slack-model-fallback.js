/**
 * Model choice for sessions started from Slack when the user has no default session model.
 *
 * Slack replies are quick back-and-forth, so rather than failing we pick the cheapest common
 * model the user's agent configurations can actually reach, at medium reasoning effort. If the
 * user has set a default (or there is nothing to pick from) the normal resolution applies.
 */
import { BadRequest } from '@feathersjs/errors';
import { coerceModelParams } from '../../shared/agent-session-defaults.js';
import { parseAgentDefaultModelJson } from '../../shared/agent-default-model.js';
import { effortOptionFromPref } from '../../shared/model-variants.js';
import {
  MCP_BUILDER_MODEL_SETTINGS_ERROR,
  resolveMcpBuilderModel,
} from './agent-mcp-model-resolver.js';
import { listModelsForOwnedConfig } from './feathers/agent-configs.service.js';
import { mentionsWord } from './slack-text.js';

/** Cheapest first; the first pattern that matches any available model wins. */
const CHEAP_MODEL_PATTERNS = [/haiku/i, /luna/i, /qwen/i, /mini|flash|lite|nano|small/i];

const EFFORT_PARAM_IDS = new Set(['effort', 'reasoning_effort']);
const PREFERRED_EFFORT = 'medium';

/** @param {Array<{ model: { id: string }, config: object }>} candidates */
export function pickCheapCandidate(candidates) {
  for (const pattern of CHEAP_MODEL_PATTERNS) {
    const match = candidates.find(({ model }) =>
      pattern.test(`${model.id} ${model.display_name ?? ''}`)
    );
    if (match) return match;
  }
  return candidates[0] ?? null;
}

/** Variant params at medium effort (or the nearest tier the model offers); null if none apply. */
export function mediumEffortParams(model) {
  const variants = model.variants ?? [];
  const efforts = new Set();
  for (const v of variants) {
    for (const p of v.params ?? []) {
      if (EFFORT_PARAM_IDS.has(p.id)) efforts.add(p.value);
    }
  }
  if (!efforts.size) return null;
  const wanted = effortOptionFromPref(PREFERRED_EFFORT, [...efforts]);
  const variant = variants.find((v) =>
    (v.params ?? []).some((p) => EFFORT_PARAM_IDS.has(p.id) && p.value === wanted)
  );
  return coerceModelParams(variant?.params ?? null);
}

async function listCandidates(app, userId) {
  const configs = await app
    .get('db')('agent_configs')
    .where({ user_id: userId })
    .whereNull('deleted_at')
    .orderBy('id', 'asc');
  const candidates = [];
  for (const config of configs) {
    try {
      const { models } = await listModelsForOwnedConfig(app, { configId: config.id, userId });
      for (const model of models ?? []) candidates.push({ config, model });
    } catch {
      // A config with broken credentials just contributes no models.
    }
  }
  return candidates;
}

/**
 * Same contract as `resolveMcpBuilderModel`: the user's default when set, else the cheapest
 * available model. Throws the usual "configure a default" error when nothing is available.
 */
export function createSlackModelResolver(app) {
  return async function resolveSlackBuilderModel(db, userId, opts = {}) {
    try {
      return await resolveMcpBuilderModel(db, userId, opts);
    } catch (err) {
      if (err.message !== MCP_BUILDER_MODEL_SETTINGS_ERROR) throw err;
    }
    const pick = pickCheapCandidate(await listCandidates(app, userId));
    if (!pick) throw new BadRequest(MCP_BUILDER_MODEL_SETTINGS_ERROR);
    return {
      agent_config_id: pick.config.id,
      agent_sdk: pick.config.sdk,
      model: pick.model.id,
      model_params: mediumEffortParams(pick.model),
    };
  };
}

const tokensOf = (value) =>
  String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));

/** "Composer 2.5" → [2, 5]; "claude-sonnet-4-5" → [4, 5]; no number → []. */
export function versionOf(model) {
  const source = String(model.display_name || model.id || '');
  const match = source.replace(/(\d)-(\d)/g, '$1.$2').match(/\d+(?:\.\d+)*/);
  return match ? match[0].split('.').map(Number) : [];
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * The model among `candidates` ({ config, model }) the text names, or null. A model matches on
 * words that tell it apart from its siblings ("sonnet", "grok", "composer") — not on words every
 * model of that config shares ("claude") — and on its version when the text gives one
 * ("composer 2.5"). When only the family is named, the newest version wins.
 */
export function pickModelNamedInText(candidates, text) {
  const byConfig = new Map();
  for (const c of candidates) {
    if (!byConfig.has(c.config.id)) byConfig.set(c.config.id, []);
    byConfig.get(c.config.id).push(c);
  }
  let best = null;
  for (const group of byConfig.values()) {
    const tokenSets = group.map(
      ({ model }) => new Set(tokensOf(`${model.id} ${model.display_name ?? ''}`))
    );
    const shared =
      group.length > 1
        ? new Set([...tokenSets[0]].filter((t) => tokenSets.every((set) => set.has(t))))
        : new Set();
    group.forEach((candidate, index) => {
      const label = String(candidate.model.display_name ?? '').trim();
      let score = 0;
      for (const token of tokenSets[index]) {
        if (!shared.has(token) && mentionsWord(text, token)) score += 1;
      }
      if (
        score === 0 &&
        !(label && mentionsWord(text, label)) &&
        !mentionsWord(text, candidate.model.id)
      ) {
        return;
      }
      if (label && mentionsWord(text, label)) score += 2;
      if (mentionsWord(text, candidate.model.id)) score += 2;
      const version = versionOf(candidate.model);
      if (version.length && mentionsWord(text, version.join('.'))) score += 1;
      const better =
        !best ||
        score > best.score ||
        (score === best.score && compareVersions(version, best.version) > 0);
      if (better) best = { candidate, score, version };
    });
  }
  return best?.candidate ?? null;
}

/** "(cursor, Grok 4.6)" — the provider and model a session was started with. */
export function describeChoice(choice) {
  return `${choice.agent_sdk}, ${choice.model_label ?? choice.model}`;
}

function choiceFrom({ config, model }) {
  return {
    agent_config_id: config.id,
    agent_sdk: config.sdk,
    model: model.id,
    model_label: model.display_name ?? model.id,
    model_params: mediumEffortParams(model),
  };
}

/**
 * Provider + model for a Slack-started session. Names in the message win ("use cursor", "with
 * sonnet", "grok 4.6"): an agent configuration (by label or SDK name) and/or a model. Anything
 * not named falls back to the user's default, else the cheapest available model.
 */
export async function resolveSlackModelChoice(app, userId, text) {
  const db = app.get('db');
  const configs = await db('agent_configs')
    .where({ user_id: userId })
    .whereNull('deleted_at')
    .orderBy('id', 'asc');
  const namedConfigs = configs.filter(
    (c) => mentionsWord(text, c.label) || mentionsWord(text, c.sdk)
  );

  const candidates = await listCandidates(app, userId);
  const inScope = namedConfigs.length
    ? candidates.filter((c) => namedConfigs.some((n) => n.id === c.config.id))
    : candidates;

  const named = pickModelNamedInText(inScope, text);
  if (named) return choiceFrom(named);

  if (namedConfigs.length && inScope.length) {
    const defaultModel = parseAgentDefaultModelJson(namedConfigs[0].default_model).model;
    const preferred = inScope.find(({ model }) => model.id === defaultModel);
    return choiceFrom(preferred ?? pickCheapCandidate(inScope));
  }

  const resolved = await createSlackModelResolver(app)(db, userId, {});
  const match = candidates.find(
    (c) => c.config.id === resolved.agent_config_id && c.model.id === resolved.model
  );
  return { ...resolved, model_label: match?.model.display_name ?? resolved.model };
}
