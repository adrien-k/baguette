const PROVIDER_LABELS = {
  lunaroute: 'LunaRoute',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

const HTTP_STATUS_PHRASES = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

function providerLabel(providerId) {
  const key = String(providerId ?? '').toLowerCase();
  if (PROVIDER_LABELS[key]) return PROVIDER_LABELS[key];
  if (!key) return 'API';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function httpStatusPhrase(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return null;
  return HTTP_STATUS_PHRASES[n] ?? null;
}

function tryParseJson(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function sentenceCase(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function messagesEquivalent(a, b) {
  const left = String(a ?? '')
    .trim()
    .toLowerCase();
  const right = String(b ?? '')
    .trim()
    .toLowerCase();
  if (!left || !right) return false;
  return left === right;
}

/**
 * Turn a raw agent `error_message` into user-facing chat copy.
 * @param {string | null | undefined} raw
 * @returns {{ headline: string, detail: string | null, raw: string }}
 */
export function formatTurnErrorMessage(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return { headline: 'Turn failed', detail: null, raw: text };
  }

  const apiMatch = text.match(/^([\w-]+)\s+API error\s+\((\d+)\):\s*(.*)$/i);
  if (apiMatch) {
    const [, providerId, statusCode, rest] = apiMatch;
    const phrase = httpStatusPhrase(statusCode);
    const statusLabel = phrase ? `${statusCode} ${phrase}` : statusCode;
    const headline = `${providerLabel(providerId)} API error (${statusLabel})`;

    const parsed = tryParseJson(rest);
    let detail = null;
    if (parsed && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      let msg = null;
      if (typeof parsed.message === 'string') msg = parsed.message;
      else if (typeof parsed.error === 'string') msg = parsed.error;
      if (msg && !messagesEquivalent(msg, phrase) && !messagesEquivalent(msg, statusLabel)) {
        detail = sentenceCase(msg);
      }
    } else if (rest && !tryParseJson(rest)) {
      detail = sentenceCase(rest);
    }

    return { headline, detail, raw: text };
  }

  const codePrefix = text.match(/^(\d{3}):\s*(.+)$/);
  if (codePrefix) {
    const [, statusCode, message] = codePrefix;
    const phrase = httpStatusPhrase(statusCode);
    const headline = phrase ? `${statusCode} ${phrase}` : statusCode;
    const detail = messagesEquivalent(message, phrase) ? null : sentenceCase(message);
    return { headline, detail, raw: text };
  }

  return { headline: text, detail: null, raw: text };
}
