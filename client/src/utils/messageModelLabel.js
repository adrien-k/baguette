import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';
import { variantLabel } from '@baguette/shared/model-variants.js';
import { parseModelField } from './models.js';

function parseModelParams(modelParams) {
  if (modelParams == null || modelParams === '') return null;
  if (Array.isArray(modelParams)) return modelParams;
  if (typeof modelParams === 'string') {
    try {
      const parsed = JSON.parse(modelParams);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Multi-line param summary for tooltips (id: value per line). */
export function messageModelParamsText(modelParams, models, model) {
  const params = parseModelParams(modelParams);
  if (!params?.length) return null;
  const modelObj = models?.find((m) => m.id === model);
  if (modelObj?.variants?.length) {
    const variant = modelObj.variants.find((v) =>
      v.params?.every((p) => params.some((sp) => sp.id === p.id && sp.value === p.value))
    );
    if (variant) {
      const vLabel = variantLabel(variant, modelObj.display_name);
      if (vLabel) return vLabel;
    }
  }
  return params.map((p) => `${p.id}: ${p.value}`).join('\n');
}

/** Display name only (no variant suffix) for compact inline labels. */
export function messageModelDisplayName({ model, models }) {
  if (!model) return null;
  const modelObj = models?.find((m) => m.id === model);
  return modelObj?.display_name || parseModelField(model);
}

/** Short label for a user message's model + optional Cursor variant. */
export function messageModelLabel({ model, modelParams, models }) {
  if (!model) return null;
  const modelObj = models?.find((m) => m.id === model);
  const displayName = modelObj?.display_name || parseModelField(model);
  const params = parseModelParams(modelParams);
  if (!params || !modelObj?.variants?.length) return displayName;
  try {
    const variant = modelObj.variants.find((v) =>
      v.params?.every((p) => params.some((sp) => sp.id === p.id && sp.value === p.value))
    );
    if (!variant) return displayName;
    const vLabel = variantLabel(variant, modelObj.display_name);
    if (!vLabel || vLabel === displayName) return displayName;
    return `${displayName} · ${vLabel}`;
  } catch {
    return displayName;
  }
}

/** Light subtitle for a review issue: SDK · model · variant. */
export function issueAgentSubtitle({ agent_sdk, model, model_params, models }) {
  const sdkLabel = agent_sdk ? formatAgentSdkDisplayName(agent_sdk) : null;
  const modelLabel = messageModelLabel({ model, modelParams: model_params, models });
  const parts = [sdkLabel, modelLabel].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
