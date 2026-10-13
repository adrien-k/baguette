import { stringifyModelParamsForStorage } from '../../shared/agent-session-defaults.js';

/**
 * Pricing snapshot stored on a usage row. Reads the turn's message-row model
 * (`turnModel` from `requireTurnModelFromRow`); billed `turnUsage.model` may
 * override the id when the SDK reports a more specific model.
 *
 * @param {{ model?: string|null, modelParams?: unknown } | null | undefined} turnModel
 * @param {{ model?: string|null } | null | undefined} [turnUsage]
 */
export function usagePricingSnapshotForCost(turnModel, turnUsage) {
  if (turnModel?.model == null || turnModel.model === '') {
    throw new Error('Model is required to record usage');
  }
  return {
    model: turnUsage?.model ?? turnModel.model,
    model_params: stringifyModelParamsForStorage(turnModel.modelParams),
  };
}
