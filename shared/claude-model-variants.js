import { buildVariantsFromParamAxes } from './model-variant-axes.js';

const CLAUDE_DEFAULT_FAST = 'false';
const CLAUDE_DEFAULT_CONTEXT = '200k';

/**
 * Heuristic effort levels when the model list carries no SDK effort metadata
 * (Anthropic gateway rows, older SDK lists). Mirrors Anthropic's per-model table:
 *
 * - `low|medium|high|xhigh|max` — Fable 5/5.1, Mythos 5/5.1, Opus 5.5/5/4.8/4.7,
 *   Sonnet 5.5/5, Haiku 5.5
 * - `max` without `xhigh` — Opus 4.6, Sonnet 4.6
 * - `low|medium|high` — other effort-capable models (Opus 4.5, Sonnet 4/4.5, Haiku 4.5)
 */
const XHIGH_EFFORT_PATTERN = /opus-4-[78]|opus-5|sonnet-5|haiku-5|fable|mythos/;
const MAX_EFFORT_PATTERN = /opus-4-[678]|opus-5|sonnet-4-6|sonnet-5|haiku-5|fable|mythos/;

/** Anthropic API default effort is `medium` on Opus 5.5 and Haiku 5.5, `high` elsewhere. */
const MEDIUM_DEFAULT_EFFORT_PATTERN = /opus-5-5|haiku-5-5/;

function normalizeModelId(modelId) {
  return String(modelId ?? '')
    .trim()
    .toLowerCase();
}

/** Models that support the 1M context beta via model_params.context (not a separate picker id). */
export function claudeModelSupports1mContext(modelId) {
  const id = normalizeModelId(modelId);
  if (!id) return false;
  const without1m = id.replace(/\[1m\]$/, '');
  return (
    id.includes('claude-sonnet-4') ||
    id.includes('sonnet-4-5') ||
    id.includes('sonnet-4-6') ||
    without1m === 'sonnet' ||
    without1m === 'default' ||
    without1m === 'opus' ||
    id.includes('claude-opus') ||
    id.includes('fable')
  );
}

/** @param {Record<string, unknown> | null | undefined} modelInfo @param {string} modelId */
export function claudeModelVariantAxes(modelInfo, modelId) {
  const axes = [];
  const info = modelInfo ?? {};

  if (info.supportsEffort) {
    const levels = info.supportedEffortLevels?.length
      ? info.supportedEffortLevels
      : ['low', 'medium', 'high'];
    axes.push({ id: 'effort', values: [...levels] });
  } else if (claudeHeuristicSupportsEffort(modelId)) {
    axes.push({ id: 'effort', values: claudeHeuristicEffortLevels(modelId) });
  }

  if (info.supportsFastMode || claudeHeuristicSupportsFast(modelId)) {
    axes.push({ id: 'fast', values: ['false', 'true'] });
  }

  if (claudeModelSupports1mContext(modelId)) {
    axes.push({ id: 'context', values: ['200k', '1m'] });
  }

  return axes;
}

function claudeHeuristicSupportsEffort(modelId) {
  const id = normalizeModelId(modelId);
  return /opus|sonnet|fable|mythos|haiku/.test(id);
}

function claudeHeuristicEffortLevels(modelId) {
  const id = normalizeModelId(modelId);
  const levels = ['low', 'medium', 'high'];
  if (XHIGH_EFFORT_PATTERN.test(id)) levels.push('xhigh');
  if (MAX_EFFORT_PATTERN.test(id)) levels.push('max');
  return levels;
}

function claudeHeuristicSupportsFast(modelId) {
  return normalizeModelId(modelId).includes('opus-4-7');
}

function claudeHeuristicDefaultEffort(modelId) {
  if (MEDIUM_DEFAULT_EFFORT_PATTERN.test(normalizeModelId(modelId))) return 'medium';
  return 'high';
}

/**
 * Default effort for a model, clamped to the levels actually offered (SDK metadata may
 * expose a narrower list than the heuristics would pick from).
 *
 * @param {string} modelId
 * @param {string[] | undefined} effortValues
 */
function claudeDefaultEffort(modelId, effortValues) {
  const preferred = claudeHeuristicDefaultEffort(modelId);
  if (!Array.isArray(effortValues) || !effortValues.length) return preferred;
  if (effortValues.includes(preferred)) return preferred;
  if (effortValues.includes('high')) return 'high';
  return effortValues[0];
}

/**
 * @param {{ id: string, display_name?: string, description?: string | null, _claudeModelInfo?: Record<string, unknown> }} model
 */
export function attachClaudeModelVariants(model) {
  const axes = claudeModelVariantAxes(model._claudeModelInfo, model.id);
  if (!axes.length) return model;
  const effortValues = axes.find((a) => a.id === 'effort')?.values;
  const defaultParams = [
    { id: 'effort', value: claudeDefaultEffort(model.id, effortValues) },
    { id: 'fast', value: CLAUDE_DEFAULT_FAST },
    { id: 'context', value: CLAUDE_DEFAULT_CONTEXT },
  ].filter((p) => axes.some((a) => a.id === p.id));
  const variants = buildVariantsFromParamAxes(axes, { defaultParams });
  return { ...model, variants };
}
