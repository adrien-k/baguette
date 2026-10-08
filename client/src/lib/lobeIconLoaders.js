/**
 * Per-icon dynamic imports for the curated agent-config logo set only.
 * Avoids loading the full @lobehub/icons barrel.
 */
import { LOBE_ICON_IDS } from '@baguette/shared/agent-config-logo.js';

/** @type {Record<string, () => Promise<{ default: object }>>} */
const LOADERS = {
  Anthropic: () => import('@lobehub/icons/es/Anthropic'),
  Claude: () => import('@lobehub/icons/es/Claude'),
  ClaudeCode: () => import('@lobehub/icons/es/ClaudeCode'),
  OpenAI: () => import('@lobehub/icons/es/OpenAI'),
  Google: () => import('@lobehub/icons/es/Google'),
  Gemini: () => import('@lobehub/icons/es/Gemini'),
  Meta: () => import('@lobehub/icons/es/Meta'),
  Mistral: () => import('@lobehub/icons/es/Mistral'),
  Cohere: () => import('@lobehub/icons/es/Cohere'),
  DeepSeek: () => import('@lobehub/icons/es/DeepSeek'),
  Grok: () => import('@lobehub/icons/es/Grok'),
  XAI: () => import('@lobehub/icons/es/XAI'),
  Cursor: () => import('@lobehub/icons/es/Cursor'),
  OpenRouter: () => import('@lobehub/icons/es/OpenRouter'),
  OpenCode: () => import('@lobehub/icons/es/OpenCode'),
  Groq: () => import('@lobehub/icons/es/Groq'),
  Together: () => import('@lobehub/icons/es/Together'),
  Fireworks: () => import('@lobehub/icons/es/Fireworks'),
  Perplexity: () => import('@lobehub/icons/es/Perplexity'),
  Azure: () => import('@lobehub/icons/es/Azure'),
  AzureAI: () => import('@lobehub/icons/es/AzureAI'),
  Aws: () => import('@lobehub/icons/es/Aws'),
  Bedrock: () => import('@lobehub/icons/es/Bedrock'),
  VertexAI: () => import('@lobehub/icons/es/VertexAI'),
  Cloudflare: () => import('@lobehub/icons/es/Cloudflare'),
  Vercel: () => import('@lobehub/icons/es/Vercel'),
  Baseten: () => import('@lobehub/icons/es/Baseten'),
  Ollama: () => import('@lobehub/icons/es/Ollama'),
  HuggingFace: () => import('@lobehub/icons/es/HuggingFace'),
  Replicate: () => import('@lobehub/icons/es/Replicate'),
  Nvidia: () => import('@lobehub/icons/es/Nvidia'),
  Microsoft: () => import('@lobehub/icons/es/Microsoft'),
  Copilot: () => import('@lobehub/icons/es/Copilot'),
  GithubCopilot: () => import('@lobehub/icons/es/GithubCopilot'),
  Alibaba: () => import('@lobehub/icons/es/Alibaba'),
  Qwen: () => import('@lobehub/icons/es/Qwen'),
  Moonshot: () => import('@lobehub/icons/es/Moonshot'),
  Zhipu: () => import('@lobehub/icons/es/Zhipu'),
  Minimax: () => import('@lobehub/icons/es/Minimax'),
  Pi: () => import('@lobehub/icons/es/Pi'),
  LobeHub: () => import('@lobehub/icons/es/LobeHub'),
};

const cache = new Map();

export function canLoadLobeIcon(iconId) {
  return LOBE_ICON_IDS.has(iconId) && Boolean(LOADERS[iconId]);
}

export function loadLobeIconModule(iconId) {
  const loader = LOADERS[iconId];
  if (!loader) return Promise.resolve(null);
  if (!cache.has(iconId)) {
    cache.set(
      iconId,
      loader().then((mod) => mod.default ?? null)
    );
  }
  return cache.get(iconId);
}
