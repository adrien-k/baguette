/**
 * Per-icon dynamic imports for the curated agent-config logo set only.
 * Uses @lobehub/icons-static-avatar (pre-rendered round marks, same as Lobe Icon.Avatar).
 */

/** @type {Record<string, () => Promise<{ default: string }>>} */
const LOADERS = {
  Anthropic: () => import('@lobehub/icons-static-avatar/avatars/anthropic.webp?url'),
  Claude: () => import('@lobehub/icons-static-avatar/avatars/claude.webp?url'),
  ClaudeCode: () => import('@lobehub/icons-static-avatar/avatars/claudecode.webp?url'),
  OpenAI: () => import('@lobehub/icons-static-avatar/avatars/openai.webp?url'),
  Google: () => import('@lobehub/icons-static-avatar/avatars/google.webp?url'),
  Gemini: () => import('@lobehub/icons-static-avatar/avatars/gemini.webp?url'),
  Meta: () => import('@lobehub/icons-static-avatar/avatars/meta.webp?url'),
  Mistral: () => import('@lobehub/icons-static-avatar/avatars/mistral.webp?url'),
  Cohere: () => import('@lobehub/icons-static-avatar/avatars/cohere.webp?url'),
  DeepSeek: () => import('@lobehub/icons-static-avatar/avatars/deepseek.webp?url'),
  Grok: () => import('@lobehub/icons-static-avatar/avatars/grok.webp?url'),
  XAI: () => import('@lobehub/icons-static-avatar/avatars/xai.webp?url'),
  Cursor: () => import('@lobehub/icons-static-avatar/avatars/cursor.webp?url'),
  OpenRouter: () => import('@lobehub/icons-static-avatar/avatars/openrouter.webp?url'),
  OpenCode: () => import('@lobehub/icons-static-avatar/avatars/opencode.webp?url'),
  Groq: () => import('@lobehub/icons-static-avatar/avatars/groq.webp?url'),
  Together: () => import('@lobehub/icons-static-avatar/avatars/together.webp?url'),
  Fireworks: () => import('@lobehub/icons-static-avatar/avatars/fireworks.webp?url'),
  Perplexity: () => import('@lobehub/icons-static-avatar/avatars/perplexity.webp?url'),
  Azure: () => import('@lobehub/icons-static-avatar/avatars/azure.webp?url'),
  AzureAI: () => import('@lobehub/icons-static-avatar/avatars/azureai.webp?url'),
  Aws: () => import('@lobehub/icons-static-avatar/avatars/aws.webp?url'),
  Bedrock: () => import('@lobehub/icons-static-avatar/avatars/bedrock.webp?url'),
  VertexAI: () => import('@lobehub/icons-static-avatar/avatars/vertexai.webp?url'),
  Cloudflare: () => import('@lobehub/icons-static-avatar/avatars/cloudflare.webp?url'),
  Vercel: () => import('@lobehub/icons-static-avatar/avatars/vercel.webp?url'),
  Baseten: () => import('@lobehub/icons-static-avatar/avatars/baseten.webp?url'),
  Ollama: () => import('@lobehub/icons-static-avatar/avatars/ollama.webp?url'),
  HuggingFace: () => import('@lobehub/icons-static-avatar/avatars/huggingface.webp?url'),
  Replicate: () => import('@lobehub/icons-static-avatar/avatars/replicate.webp?url'),
  Nvidia: () => import('@lobehub/icons-static-avatar/avatars/nvidia.webp?url'),
  Microsoft: () => import('@lobehub/icons-static-avatar/avatars/microsoft.webp?url'),
  Copilot: () => import('@lobehub/icons-static-avatar/avatars/copilot.webp?url'),
  GithubCopilot: () => import('@lobehub/icons-static-avatar/avatars/githubcopilot.webp?url'),
  Alibaba: () => import('@lobehub/icons-static-avatar/avatars/alibaba.webp?url'),
  Qwen: () => import('@lobehub/icons-static-avatar/avatars/qwen.webp?url'),
  Moonshot: () => import('@lobehub/icons-static-avatar/avatars/moonshot.webp?url'),
  Zhipu: () => import('@lobehub/icons-static-avatar/avatars/zhipu.webp?url'),
  Minimax: () => import('@lobehub/icons-static-avatar/avatars/minimax.webp?url'),
  Pi: () => import('@lobehub/icons-static-avatar/avatars/pi.webp?url'),
  Antigravity: () => import('@lobehub/icons-static-avatar/avatars/antigravity.webp?url'),
  LobeHub: () => import('@lobehub/icons-static-avatar/avatars/lobehub.webp?url'),
};

const cache = new Map();

/** @returns {Promise<string | null>} Resolved asset URL for the icon mark. */
export function loadLobeIconUrl(iconId) {
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
