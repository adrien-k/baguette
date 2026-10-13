export function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...data }, null, 2) }] };
}

export function fail(message) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }, null, 2) }],
  };
}

/** @returns {{ ok: boolean; error?: string; [key: string]: unknown } | null} */
function parseBaguetteMcpToolResult(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    return null;
  }
  return null;
}

export function baguetteMcpToolSucceeded(result) {
  const parsed = parseBaguetteMcpToolResult(result);
  if (!parsed) return true;
  return parsed.ok !== false;
}
