/**
 * Placeholder for the agent config API key field (Settings → Agent).
 * @param {{ secretPlaceholder?: string, secretPlaceholderByEnvVar?: Record<string, string> | null } | null | undefined} schema
 * @param {string | null | undefined} apiKeyEnvVar
 */
export function agentConfigSecretPlaceholder(schema, apiKeyEnvVar) {
  if (apiKeyEnvVar && schema?.secretPlaceholderByEnvVar?.[apiKeyEnvVar]) {
    return schema.secretPlaceholderByEnvVar[apiKeyEnvVar];
  }
  return schema?.secretPlaceholder ?? 'API key';
}
