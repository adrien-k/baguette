import type { OpenAICompletionsCompat, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { NON_CHAT_CAPABILITIES } from './constants.js';

export type InputLimits = {
  maxRequestBytes?: number;
  images?: {
    resize?: { maxWidth?: number; maxHeight?: number; maxBytes?: number; jpegQuality?: number };
    maxPerMessage?: number;
    maxPerRequest?: number;
  };
};

export type ChatLunarouteModelConfig = {
  id: string;
  name: string;
  reasoning: boolean;
  input: ('text' | 'image')[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: ThinkingLevelMap;
  compat?: OpenAICompletionsCompat;
  inputLimits?: InputLimits;
  baseUrl?: string;
};

export type GatewayPiBlock = Partial<OpenAICompletionsCompat> & {
  thinkingLevelMap?: ThinkingLevelMap;
  compat?: OpenAICompletionsCompat;
  inputLimits?: InputLimits;
};

export type GatewayModelObject = {
  id: string;
  display_name?: string;
  context_window?: number;
  max_output_tokens?: number;
  capabilities?: Record<string, boolean>;
  client_compat?: { pi?: GatewayPiBlock } | null;
  pi?: GatewayPiBlock;
};

export type CatalogMappingResult =
  | { ok: true; model: ChatLunarouteModelConfig }
  | { ok: false; reason: 'reasoning_missing_pi_block'; id: string }
  | { ok: false; reason: 'missing_window_metadata'; id: string }
  | { ok: false; reason: 'non_chat_capability'; id: string; capability: string };

const LUNAROUTE_FALLBACK_IMAGE_RESIZE = {
  maxWidth: 2048,
  maxHeight: 2048,
  maxBytes: 1_000_000,
  jpegQuality: 80,
};

function normalizeGatewayPiBlock(pi: GatewayPiBlock): {
  thinkingLevelMap?: ThinkingLevelMap;
  compat?: OpenAICompletionsCompat;
} {
  const { thinkingLevelMap, compat: nestedCompat, inputLimits: _inputLimits, ...flatCompat } = pi;
  return {
    thinkingLevelMap,
    compat: nestedCompat ?? (Object.keys(flatCompat).length > 0 ? flatCompat : undefined),
  };
}

export function mapCatalogEntry(entry: GatewayModelObject): CatalogMappingResult {
  for (const capability of NON_CHAT_CAPABILITIES) {
    if (entry.capabilities?.[capability] === true) {
      return { ok: false, reason: 'non_chat_capability', id: entry.id, capability };
    }
  }
  const reasoning = entry.capabilities?.reasoning === true;
  const input: ('text' | 'image')[] =
    entry.capabilities?.vision === true ? ['text', 'image'] : ['text'];
  const gatewayPi = entry.client_compat?.pi ?? entry.pi;

  if (!entry.context_window || !entry.max_output_tokens) {
    return { ok: false, reason: 'missing_window_metadata', id: entry.id };
  }

  if (reasoning && !gatewayPi) {
    return { ok: false, reason: 'reasoning_missing_pi_block', id: entry.id };
  }

  const model: ChatLunarouteModelConfig = {
    id: entry.id,
    name: entry.display_name ?? entry.id,
    reasoning,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: entry.context_window,
    maxTokens: entry.max_output_tokens,
  };
  if (reasoning && gatewayPi) {
    const { thinkingLevelMap, compat } = normalizeGatewayPiBlock(gatewayPi);
    if (thinkingLevelMap) model.thinkingLevelMap = thinkingLevelMap;
    if (compat) model.compat = compat;
  }
  if (input.includes('image')) {
    const catalogLimits = gatewayPi?.inputLimits;
    model.inputLimits = {
      ...catalogLimits,
      images: {
        ...catalogLimits?.images,
        resize: catalogLimits?.images?.resize ?? LUNAROUTE_FALLBACK_IMAGE_RESIZE,
      },
    };
  }
  return { ok: true, model };
}
