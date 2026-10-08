/** True until models have been fetched for `configId` (SDK/config switch in flight). */
export function isAgentConfigModelsStale(loadedForId, configId) {
  if (configId == null || configId === '') return true;
  if (loadedForId == null || loadedForId === '') return true;
  return String(loadedForId) !== String(configId);
}
