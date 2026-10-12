/** Curated {@link https://github.com/lobehub/lobe-icons | Lobe} marks (gateways + major model brands). */
export const AGENT_CONFIG_LOGO_OPTIONS = [
  { id: 'Anthropic', fullTitle: 'Anthropic' },
  { id: 'Claude', fullTitle: 'Claude' },
  { id: 'ClaudeCode', fullTitle: 'Claude Code' },
  { id: 'OpenAI', fullTitle: 'OpenAI' },
  { id: 'Google', fullTitle: 'Google' },
  { id: 'Gemini', fullTitle: 'Gemini' },
  { id: 'Meta', fullTitle: 'Meta' },
  { id: 'Mistral', fullTitle: 'Mistral' },
  { id: 'Cohere', fullTitle: 'Cohere' },
  { id: 'DeepSeek', fullTitle: 'DeepSeek' },
  { id: 'Grok', fullTitle: 'Grok (xAI)' },
  { id: 'XAI', fullTitle: 'xAI' },
  { id: 'Cursor', fullTitle: 'Cursor' },
  { id: 'OpenRouter', fullTitle: 'OpenRouter' },
  { id: 'OpenCode', fullTitle: 'OpenCode' },
  { id: 'Groq', fullTitle: 'Groq' },
  { id: 'Together', fullTitle: 'Together AI' },
  { id: 'Fireworks', fullTitle: 'Fireworks AI' },
  { id: 'Perplexity', fullTitle: 'Perplexity' },
  { id: 'Azure', fullTitle: 'Microsoft Azure' },
  { id: 'AzureAI', fullTitle: 'Azure OpenAI' },
  { id: 'Aws', fullTitle: 'Amazon Web Services' },
  { id: 'Bedrock', fullTitle: 'Amazon Bedrock' },
  { id: 'VertexAI', fullTitle: 'Google Vertex AI' },
  { id: 'Cloudflare', fullTitle: 'Cloudflare' },
  { id: 'Vercel', fullTitle: 'Vercel' },
  { id: 'Baseten', fullTitle: 'Baseten' },
  { id: 'Ollama', fullTitle: 'Ollama' },
  { id: 'HuggingFace', fullTitle: 'Hugging Face' },
  { id: 'Replicate', fullTitle: 'Replicate' },
  { id: 'Nvidia', fullTitle: 'NVIDIA' },
  { id: 'Microsoft', fullTitle: 'Microsoft' },
  { id: 'Copilot', fullTitle: 'Microsoft Copilot' },
  { id: 'GithubCopilot', fullTitle: 'GitHub Copilot' },
  { id: 'Alibaba', fullTitle: 'Alibaba' },
  { id: 'Qwen', fullTitle: 'Qwen' },
  { id: 'Moonshot', fullTitle: 'Moonshot' },
  { id: 'Zhipu', fullTitle: 'Zhipu AI' },
  { id: 'Minimax', fullTitle: 'MiniMax' },
  { id: 'Pi', fullTitle: 'Pi' },
  { id: 'LobeHub', fullTitle: 'LobeHub' },
  { id: 'LunaRoute', fullTitle: 'LunaRoute' },
];

/** Lobe icon ids with bundled client assets (see `client/src/utils/agent-config-custom-logos.js`). */
export const CUSTOM_AGENT_CONFIG_LOGO_IDS = ['LunaRoute'];

/** @type {Set<string>} */
export const LOBE_ICON_IDS = new Set(AGENT_CONFIG_LOGO_OPTIONS.map((entry) => entry.id));

/** @type {Set<string>} */
export const SUPPORTED_AGENT_CONFIG_LOGO_IDS = new Set([
  ...LOBE_ICON_IDS,
  ...CUSTOM_AGENT_CONFIG_LOGO_IDS,
]);

/** Lobe icon id used when `agent_configs.logo` is null. */
export const SDK_DEFAULT_LOBE_ICON = {
  claude: 'ClaudeCode',
  cursor: 'Cursor',
  pi: 'Pi',
  mock: 'LobeHub',
};

export const SDK_DEFAULT_LOGO_OPTION = '__sdk_default__';

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function storedLogoId(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  return SUPPORTED_AGENT_CONFIG_LOGO_IDS.has(s) ? s : null;
}

/**
 * Stored `logo` on agent_configs: null means use the SDK default Lobe mark.
 * @param {unknown} logo
 * @param {string | null | undefined} sdk
 */
export function resolveAgentConfigLogoId(logo, sdk) {
  const stored = storedLogoId(logo);
  if (stored) return stored;
  return SDK_DEFAULT_LOBE_ICON[sdk] ?? SDK_DEFAULT_LOBE_ICON.claude;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeAgentConfigLogo(value) {
  if (value == null || value === '') return null;
  const stored = storedLogoId(value);
  if (stored) return stored;
  throw new Error('logo must be a supported Lobe icon id');
}
