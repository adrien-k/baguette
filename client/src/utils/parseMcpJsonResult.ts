import { extractMcpTextContent } from './shellToolResult.js';

/** Loose shape of parsed MCP JSON results consumed by chat MCP blocks. */
export type McpResultData = {
  issue?: { severity?: string; title?: string; id?: string | number };
  ok?: boolean;
  message?: string;
  url?: string;
  [key: string]: unknown;
};

function parseJsonObject(text: unknown): McpResultData | null {
  if (typeof text !== 'string' || !text.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as McpResultData) : null;
  } catch {
    return null;
  }
}

function mcpDataHasPayload(data: Record<string, unknown>): boolean {
  return (
    data.todo != null ||
    data.todos != null ||
    data.markdown != null ||
    data.agent_id != null ||
    data.ref != null ||
    data.subagent != null ||
    data.taskId != null ||
    data.task_id != null ||
    data.ok === true ||
    data.ok === false ||
    data.error != null
  );
}

function parsedFromMcpTextBlocks(obj: Record<string, unknown>): McpResultData | null {
  const mcpText = extractMcpTextContent(obj);
  if (!mcpText) return null;
  const trimmed = mcpText.trim();
  if (!trimmed.startsWith('{')) return null;
  return parseJsonObject(trimmed);
}

/** Unwrap Baguette MCP tool results (plain JSON or `{ content: [{ type: 'text', text }] }`). */
export function parseMcpJsonResult(result: unknown): McpResultData | null {
  if (result == null) return null;
  if (typeof result === 'object') {
    const obj = result as McpResultData & { data?: unknown; content?: unknown };
    const fromMcpBlocks = parsedFromMcpTextBlocks(obj as Record<string, unknown>);
    const fromContent = parseJsonObject(obj.content);

    if (obj.data != null && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
      const data = obj.data as Record<string, unknown>;
      if (mcpDataHasPayload(data)) {
        const base = fromMcpBlocks ?? fromContent;
        return base ? { ...base, ...data } : (data as McpResultData);
      }
    }

    if (fromMcpBlocks) return fromMcpBlocks;
    if (fromContent) return fromContent;
    return obj;
  }
  if (typeof result !== 'string' || !result.trim()) return null;
  return parseJsonObject(result);
}
