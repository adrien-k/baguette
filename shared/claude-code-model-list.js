/**
 * Map Claude Agent SDK supportedModels() rows to Baguette list entries.
 * Always use `value` as the picker/session model id — never synthesize ids from
 * `resolvedModel` (e.g. do not turn `default` + 1M into `default[1m]`).
 */

/**
 * @param {{ value?: string, displayName?: string, description?: string | null, resolvedModel?: string }} row
 */
export function claudeCodePickerModelId(row) {
  const id = (row?.value ?? '').trim();
  return id || null;
}

/**
 * Correct mistaken ids that append `[1m]` to an alias when only the alias is in the SDK list.
 * @param {string | null | undefined} modelId
 * @param {ReadonlySet<string>} pickerIds
 */
export function normalizeClaudeCodePickerModelId(modelId, pickerIds) {
  if (!modelId) return modelId;
  const id = String(modelId).trim();
  if (!id || pickerIds.has(id)) return id;
  const oneM = /\[1m\]$/i;
  if (oneM.test(id)) {
    const base = id.replace(oneM, '');
    if (pickerIds.has(base)) return base;
  }
  return id;
}

/**
 * @param {{ value?: string, displayName?: string, description?: string | null, resolvedModel?: string }} row
 * @param {(row: { value?: string, displayName?: string, description?: string | null, resolvedModel?: string }) => string} displayNameFn
 */
export function mapClaudeCodeSdkModelToListEntry(row, displayNameFn) {
  const id = claudeCodePickerModelId(row);
  if (!id) return null;
  return {
    id,
    display_name: displayNameFn({
      displayName: row.displayName,
      description: row.description,
      resolvedModel: row.resolvedModel,
      value: row.value,
    }),
    description: row.description ?? null,
    resolved_model: row.resolvedModel ?? null,
  };
}
