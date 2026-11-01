import { z } from 'zod';

/** Wrap a generic `{ name, description, schema, handler }` list as Cursor `customTools`. */
export function toolListToCursorCustomTools(toolList) {
  return Object.fromEntries(
    toolList.map(({ name, description, schema, handler }) => {
      const hasSchema = Object.keys(schema).length > 0;
      const inputSchema = hasSchema ? z.toJSONSchema(z.object(schema)) : undefined;
      return [name, { description, inputSchema, execute: (args) => handler(args) }];
    })
  );
}
