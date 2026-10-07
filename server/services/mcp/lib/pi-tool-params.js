import { z } from 'zod';

const SHORT_ID_RE = /^[a-f0-9]{8}$/i;

/**
 * Pi's tool runtime often passes JSON arguments as strings. Normalize before Zod parse.
 * @param {Record<string, unknown>|null|undefined} raw
 */
export function normalizeMcpParamsForPi(raw) {
  const p = { ...(raw ?? {}) };

  if (p.session_id != null && typeof p.session_id === 'string') {
    const s = p.session_id.trim();
    if (SHORT_ID_RE.test(s)) {
      p.short_id = s;
      delete p.session_id;
    } else if (/^\d+$/.test(s)) {
      p.session_id = Number(s);
    }
  }

  for (const key of Object.keys(p)) {
    const v = p[key];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    if (
      key === 'session_id' ||
      key === 'message_id' ||
      key.endsWith('_id') ||
      key === 'days' ||
      key === 'startByte' ||
      key === 'endByte' ||
      key === 'attempt' ||
      key === 'repo_id'
    ) {
      p[key] = Number(trimmed);
    }
  }

  return p;
}

/**
 * @param {Record<string, import('zod').ZodTypeAny>} shape
 * @param {Record<string, unknown>|null|undefined} rawParams
 */
export function parsePiToolParams(shape, rawParams) {
  const params = normalizeMcpParamsForPi(rawParams);
  if (!shape || Object.keys(shape).length === 0) return params;
  return z.object(shape).parse(params);
}
