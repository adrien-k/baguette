/**
 * Wrap a generic `{ name, description, schema, handler }` list into descriptors
 * consumed by the per-turn Antigravity HTTP MCP bridge.
 *
 * @param {Array<{ name: string, description?: string, schema?: object, handler: Function }>} toolList
 */
export function toolListToAntigravityMcpTools(toolList) {
  return (toolList ?? []).map(({ name, description, schema, handler }) => ({
    name,
    description: description ?? '',
    schema: schema && typeof schema === 'object' ? schema : {},
    handler,
  }));
}
