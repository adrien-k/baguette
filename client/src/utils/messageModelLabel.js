import { variantLabel } from '@baguette/shared/model-variants.js';
import { parseModelField } from './models.js';

const SDK_LABELS = { claude: 'Claude', cursor: 'Cursor' };

/** Short label for a user message's model + optional Cursor variant. */
export function messageModelLabel({ model, modelParams, models }) {
  if (!model) return null;
  const modelObj = models?.find((m) => m.id === model);
  const displayName = modelObj?.display_name || parseModelField(model);
  if (!modelParams || !modelObj?.variants?.length) return displayName;
  try {
    const params = JSON.parse(modelParams);
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
  const sdkLabel = agent_sdk ? (SDK_LABELS[agent_sdk] ?? agent_sdk) : null;
  const modelLabel = messageModelLabel({ model, modelParams: model_params, models });
  const parts = [sdkLabel, modelLabel].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
