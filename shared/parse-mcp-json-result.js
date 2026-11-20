/**
 * Unwrap Baguette MCP tool results (plain JSON or `{ content: [{ type: 'text', text }] }`).
 * Mirrors `client/src/utils/parseMcpJsonResult.ts`.
 */

function extractMcpTextContent(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const content = obj.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const textField = block.text;
    if (typeof textField === 'string') parts.push(textField);
    else if (textField && typeof textField === 'object' && typeof textField.text === 'string') {
      parts.push(textField.text);
    }
  }
  return parts.length ? parts.join('\n\n') : null;
}

function parseJsonObject(text) {
  if (typeof text !== 'string' || !text.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function mcpDataHasPayload(data) {
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
    data.error != null ||
    data.approval_requested === true ||
    data.approval_requested === false ||
    data.approval_outcome != null
  );
}

function dataFieldsOverInnerBlocks(data, fromDataBlocks) {
  if (!fromDataBlocks) return null;
  const { content: _content, ...fields } = data;
  return { ...fromDataBlocks, ...fields };
}

function parsedFromMcpTextBlocks(obj) {
  const mcpText = extractMcpTextContent(obj);
  if (!mcpText) return null;
  const trimmed = mcpText.trim();
  if (!trimmed.startsWith('{')) return null;
  return parseJsonObject(trimmed);
}

/** @param {unknown} result */
export function parseMcpJsonResult(result) {
  if (result == null) return null;
  if (typeof result === 'object') {
    const obj = result;
    const fromMcpBlocks = parsedFromMcpTextBlocks(obj);
    const fromContent = parseJsonObject(obj.content);

    if (obj.data != null && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
      const data = obj.data;
      if (mcpDataHasPayload(data)) {
        const base = fromMcpBlocks ?? fromContent;
        return base ? { ...base, ...data } : data;
      }
      const fromDataBlocks = parsedFromMcpTextBlocks(data);
      const merged = dataFieldsOverInnerBlocks(data, fromDataBlocks);
      if (merged) return merged;
    }

    if (fromMcpBlocks) return fromMcpBlocks;
    if (fromContent) return fromContent;
    return obj;
  }
  if (typeof result !== 'string' || !result.trim()) return null;
  return parseJsonObject(result);
}
