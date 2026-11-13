import { randomUUID } from 'node:crypto';

const LUNAROUTE_ENV_ROUTING_URL = 'LUNAROUTE_ROUTING_URL';
const LUNAROUTE_ENV_API_OVERRIDE = 'LUNAROUTE_API';

const DEFAULT_ROUTING_URL = 'https://gw.lunaroute.com/v1';
export type WireApi = 'openai-responses' | 'openai-completions';
const DEFAULT_API: WireApi = 'openai-responses';

const warnedApiValues = new Set<string>();

export function resolveRoutingUrl(env: NodeJS.ProcessEnv): string {
  const raw = env[LUNAROUTE_ENV_ROUTING_URL];
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim().replace(/\/$/, '');
  }
  return DEFAULT_ROUTING_URL;
}

export function resolveApi(env: NodeJS.ProcessEnv): WireApi {
  const raw = env[LUNAROUTE_ENV_API_OVERRIDE];
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_API;
  const value = raw.trim().toLowerCase();
  if (value === 'responses') return 'openai-responses';
  if (value === 'completions') return 'openai-completions';
  if (!warnedApiValues.has(value)) {
    warnedApiValues.add(value);
    process.stderr.write(
      `[lunaroute] unrecognized LUNAROUTE_API=${JSON.stringify(raw)}; falling back to openai-completions\n`
    );
  }
  return 'openai-completions';
}

export function buildAttributionHeaders(
  piVersion: string,
  sessionId: string
): Record<string, string> {
  return {
    'lunaroute-agent': `pi/${piVersion}`,
    'x-lunaroute-session': sessionId,
    'lunaroute-session-id': sessionId,
  };
}

export function newSessionId(): string {
  try {
    return randomUUID();
  } catch {
    return `baguette-lunaroute-${Date.now()}`;
  }
}
