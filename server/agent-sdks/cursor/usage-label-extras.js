import { parseModelParamsJson } from '../../../shared/agent-model-pricing.js';

/**
 * PR/Slack footer extras for a Cursor usage row. `fast` comes from stored
 * `model_params` (`id: 'fast'`), not from `agent_sdk === 'cursor'`.
 *
 * @param {{ model_params?: string|null }} row
 * @returns {{ fast: boolean }}
 */
export function usageLabelExtras(row) {
  return { fast: parseModelParamsJson(row?.model_params).fast === 'true' };
}
