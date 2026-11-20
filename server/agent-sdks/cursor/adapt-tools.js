import { z } from 'zod';

/**
 * How long a finished custom-tool result stays reusable for a Cursor retry of
 * the same call. Local runs call `execute` again with the same `toolCallId`
 * after a backend reconnect (`enableAgentRetries`, on by default). The first
 * call is still in flight and its result is dropped, so a fresh `execute`
 * would repeat the work — StartSubagent then inserts another agent.
 */
export const CURSOR_TOOL_CALL_RESULT_RETAIN_MS = 60 * 60 * 1000;

/** Settled and in-flight calls, keyed by Cursor `toolCallId`. Shared across tool-list rebuilds. */
const toolCallsById = new Map();

function scheduleDrop(toolCallId, call) {
  setTimeout(() => {
    if (toolCallsById.get(toolCallId) === call) {
      toolCallsById.delete(toolCallId);
    }
  }, CURSOR_TOOL_CALL_RESULT_RETAIN_MS);
}

/**
 * Join a repeated `execute` for the same `toolCallId` to the original promise.
 * Calls with no id run every time (nothing to dedupe on).
 */
function executeOncePerToolCall(handler) {
  return (args, context) => {
    const toolCallId = typeof context?.toolCallId === 'string' ? context.toolCallId : '';
    if (!toolCallId) return handler(args);

    const existing = toolCallsById.get(toolCallId);
    if (existing) return existing;

    // Register the promise before starting the handler so a re-entrant retry
    // joins this call, and so the handler begins in this turn (not a microtask).
    let resolveCall;
    let rejectCall;
    const call = new Promise((resolve, reject) => {
      resolveCall = resolve;
      rejectCall = reject;
    });
    toolCallsById.set(toolCallId, call);
    // Attach both outcomes so a rejection is retained for a retry and the
    // derived promise does not surface as unhandled.
    call.then(
      () => scheduleDrop(toolCallId, call),
      () => scheduleDrop(toolCallId, call)
    );
    try {
      resolveCall(handler(args));
    } catch (err) {
      rejectCall(err);
    }
    return call;
  };
}

/** Wrap a generic `{ name, description, schema, handler }` list as Cursor `customTools`. */
export function toolListToCursorCustomTools(toolList) {
  return Object.fromEntries(
    toolList.map(({ name, description, schema, handler }) => {
      const hasSchema = Object.keys(schema).length > 0;
      const inputSchema = hasSchema ? z.toJSONSchema(z.object(schema)) : undefined;
      return [name, { description, inputSchema, execute: executeOncePerToolCall(handler) }];
    })
  );
}
