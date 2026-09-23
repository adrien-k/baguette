/**
 * Normalize Cursor SDK tool_call `result` payloads for persistence and UI.
 * Cursor tools use a discriminated union: { status: "success", value } | { status: "error", error }.
 */

function errorMessageFromPayload(errorField) {
  if (errorField == null) return null;
  if (typeof errorField === 'string') return errorField;
  if (typeof errorField.message === 'string' && errorField.message) return errorField.message;
  try {
    return JSON.stringify(errorField, null, 2);
  } catch {
    return String(errorField);
  }
}

function textFromMcpContentValue(value) {
  const content = value?.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const item = content[0];
  if (typeof item?.text === 'string') return item.text;
  if (typeof item?.text?.text === 'string') return item.text.text;
  return null;
}

/**
 * @param {unknown} result - sdkMsg.result (string or object)
 * @param {{ toolCallStatus?: 'running' | 'completed' | 'error'; isErrorHint?: boolean }} [opts]
 * @returns {{ content: string; isError: boolean }}
 */
export function formatCursorToolCallResult(result, opts = {}) {
  const { toolCallStatus, isErrorHint = false } = opts;
  let isError = isErrorHint || toolCallStatus === 'error';

  if (result === undefined || result === null) {
    if (isError) {
      return { content: 'Tool call failed', isError: true };
    }
    return { content: '', isError: false };
  }

  let parsed = result;
  if (typeof result === 'string') {
    if (result === '') {
      return isError
        ? { content: 'Tool call failed', isError: true }
        : { content: '', isError: false };
    }
    try {
      parsed = JSON.parse(result);
    } catch {
      return { content: result, isError };
    }
  }

  if (parsed && typeof parsed === 'object') {
    if (parsed.status === 'error') {
      isError = true;
      const msg = errorMessageFromPayload(parsed.error);
      if (msg) return { content: msg, isError: true };
    }

    if (parsed.value?.isError === true) {
      isError = true;
    }

    const mcpText = textFromMcpContentValue(parsed.value);
    if (mcpText != null && mcpText !== '') {
      return { content: mcpText, isError };
    }

    if (mcpText === '') {
      const errFromValue = errorMessageFromPayload(parsed.value?.error ?? parsed.error);
      if (errFromValue) return { content: errFromValue, isError: true };
    }
  }

  const serialized =
    typeof result === 'string' ? result : JSON.stringify(parsed ?? result, null, 2);

  if (isError && (!serialized || serialized === '{}' || serialized === '""')) {
    return { content: 'Tool call failed', isError: true };
  }

  return { content: serialized, isError };
}
