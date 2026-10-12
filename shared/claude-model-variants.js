import { buildVariantsFromParamAxes } from './model-variant-axes.js';

const DEFAULT_CLAUDE_PARAMS = [
  { id: 'effort', value: 'high' },
  { id: 'fast', value: 'false' },
  { id: 'context', value: '200k' },
];

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
  return /opus|sonnet|fable|haiku/.test(id);
}

function claudeHeuristicEffortLevels(modelId) {
  const id = normalizeModelId(modelId);
  const levels = ['low', 'medium', 'high'];
  if (/opus-4-7|sonnet-5|fable/.test(id)) levels.push('xhigh');
  if (/opus-4-[678]|sonnet-4-6|fable/.test(id)) levels.push('max');
  return levels;
}

function claudeHeuristicSupportsFast(modelId) {
  return normalizeModelId(modelId).includes('opus-4-7');
}

/**
 * @param {{ id: string, display_name?: string, description?: string | null, _claudeModelInfo?: Record<string, unknown> }} model
 */
export function attachClaudeModelVariants(model) {
  const axes = claudeModelVariantAxes(model._claudeModelInfo, model.id);
  if (!axes.length) return model;
  const defaults = DEFAULT_CLAUDE_PARAMS.filter((p) => axes.some((a) => a.id === p.id));
  const variants = buildVariantsFromParamAxes(axes, { defaultParams: defaults });
  return { ...model, variants };
}
