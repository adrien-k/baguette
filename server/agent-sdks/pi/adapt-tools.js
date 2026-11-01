import { defineTool } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { Type } from 'typebox';
import { parsePiToolParams } from './pi-tool-params.js';

function mcpResultToPiText(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (result && Array.isArray(result.content)) {
    const parts = result.content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text);
    if (parts.length === 1) return parts[0];
    if (parts.length > 0) return parts.join('\n\n');
  }
  return JSON.stringify(result, null, 2);
}

function piToolParameters(schema) {
  const shape = schema && typeof schema === 'object' ? schema : {};
  if (Object.keys(shape).length === 0) {
    return Type.Object({}, { additionalProperties: true });
  }
  const jsonSchema = z.toJSONSchema(z.object(shape));
  return {
    ...jsonSchema,
    type: jsonSchema.type ?? 'object',
    ...(jsonSchema.properties === undefined ? { properties: {} } : {}),
  };
}

/** Wrap a generic `{ name, description, schema, handler }` list as Pi `defineTool` entries. */
export function toolListToPiCustomTools(toolList) {
  return toolList.map(({ name, description, schema, handler }) =>
    defineTool({
      name,
      label: name,
      description,
      parameters: piToolParameters(schema),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const shape = schema && typeof schema === 'object' ? schema : {};
        const parsed = parsePiToolParams(shape, params);
        const result = await handler(parsed);
        const text = mcpResultToPiText(result);
        return {
          content: [{ type: 'text', text }],
          details: {},
        };
      },
    })
  );
}
