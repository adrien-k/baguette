/** Settings API path for listing models for an agent SDK. */
export function settingsModelsUrl(agentSdk) {
  if (agentSdk === 'cursor') return '/api/settings/models?sdk=cursor';
  if (agentSdk === 'pi') return '/api/settings/models?sdk=pi';
  return '/api/settings/models';
}

export function settingsModelsRefreshUrl(agentSdk) {
  if (agentSdk === 'cursor') return '/api/settings/models/refresh?sdk=cursor';
  if (agentSdk === 'pi') return '/api/settings/models/refresh?sdk=pi';
  return '/api/settings/models/refresh';
}
