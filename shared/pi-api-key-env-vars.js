/** @typedef {{ env: string, label: string, provider_id: string }} PiApiKeyEnvVarEntry */

export const DEFAULT_PI_API_KEY_ENV_VAR = 'ANTHROPIC_API_KEY';

/**
 * Primary API-key env vars from https://pi.dev/docs/latest/providers#use-an-api-key-from-the-environment
 * plus Anthropic auth/oauth tokens from the same page.
 * @type {PiApiKeyEnvVarEntry[]}
 */
export const PI_API_KEY_ENV_VARS = [
  { env: 'ANTHROPIC_API_KEY', label: 'Anthropic', provider_id: 'anthropic' },
  { env: 'ANTHROPIC_AUTH_TOKEN', label: 'Anthropic (auth token)', provider_id: 'anthropic' },
  { env: 'ANTHROPIC_OAUTH_TOKEN', label: 'Anthropic (OAuth token)', provider_id: 'anthropic' },
  { env: 'ANT_LING_API_KEY', label: 'Ant Ling', provider_id: 'ant-ling' },
  { env: 'OPENAI_API_KEY', label: 'OpenAI', provider_id: 'openai' },
  { env: 'DEEPSEEK_API_KEY', label: 'DeepSeek', provider_id: 'deepseek' },
  { env: 'NVIDIA_API_KEY', label: 'NVIDIA NIM', provider_id: 'nvidia' },
  { env: 'GEMINI_API_KEY', label: 'Google Gemini', provider_id: 'google' },
  { env: 'COPILOT_GITHUB_TOKEN', label: 'GitHub Copilot', provider_id: 'github-copilot' },
  { env: 'MISTRAL_API_KEY', label: 'Mistral', provider_id: 'mistral' },
  { env: 'GROQ_API_KEY', label: 'Groq', provider_id: 'groq' },
  { env: 'CEREBRAS_API_KEY', label: 'Cerebras', provider_id: 'cerebras' },
  { env: 'XAI_API_KEY', label: 'xAI', provider_id: 'xai' },
  { env: 'OPENROUTER_API_KEY', label: 'OpenRouter', provider_id: 'openrouter' },
  { env: 'AI_GATEWAY_API_KEY', label: 'Vercel AI Gateway', provider_id: 'vercel-ai-gateway' },
  { env: 'ZAI_API_KEY', label: 'ZAI Coding Plan (Global)', provider_id: 'zai' },
  { env: 'ZAI_CODING_CN_API_KEY', label: 'ZAI Coding Plan (China)', provider_id: 'zai-coding-cn' },
  { env: 'OPENCODE_API_KEY', label: 'OpenCode Zen', provider_id: 'opencode' },
  { env: 'OPENCODE_GO_API_KEY', label: 'OpenCode Go', provider_id: 'opencode-go' },
  { env: 'RADIUS_API_KEY', label: 'Radius', provider_id: 'radius' },
  { env: 'TYPESAFE_API_KEY', label: 'TypeSafe', provider_id: 'typesafe' },
  { env: 'HF_TOKEN', label: 'Hugging Face', provider_id: 'huggingface' },
  { env: 'FIREWORKS_API_KEY', label: 'Fireworks', provider_id: 'fireworks' },
  { env: 'TOGETHER_API_KEY', label: 'Together AI', provider_id: 'together' },
  { env: 'BASETEN_API_KEY', label: 'Baseten', provider_id: 'baseten' },
  { env: 'KIMI_API_KEY', label: 'Kimi For Coding', provider_id: 'kimi' },
  { env: 'META_API_KEY', label: 'Meta', provider_id: 'meta' },
  { env: 'MINIMAX_API_KEY', label: 'MiniMax', provider_id: 'minimax' },
  { env: 'MINIMAX_CN_API_KEY', label: 'MiniMax (China)', provider_id: 'minimax-cn' },
  { env: 'MOONSHOT_API_KEY', label: 'Moonshot AI', provider_id: 'moonshot' },
  { env: 'QWEN_TOKEN_PLAN_API_KEY', label: 'Qwen Token Plan', provider_id: 'qwen-token-plan' },
  {
    env: 'QWEN_TOKEN_PLAN_CN_API_KEY',
    label: 'Qwen Token Plan (China)',
    provider_id: 'qwen-token-plan-cn',
  },
  { env: 'XIAOMI_API_KEY', label: 'Xiaomi MiMo', provider_id: 'xiaomi' },
  {
    env: 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
    label: 'Xiaomi MiMo Token Plan (China)',
    provider_id: 'xiaomi-token-cn',
  },
  {
    env: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
    label: 'Xiaomi MiMo Token Plan (Amsterdam)',
    provider_id: 'xiaomi-token-ams',
  },
  {
    env: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
    label: 'Xiaomi MiMo Token Plan (Singapore)',
    provider_id: 'xiaomi-token-sgp',
  },
];

const ENV_SET = new Set(PI_API_KEY_ENV_VARS.map((e) => e.env));

/** @param {string | null | undefined} value */
export function isPiApiKeyEnvVar(value) {
  if (value == null || value === '') return false;
  const trimmed = String(value).trim();
  if (trimmed !== String(value)) return false;
  return ENV_SET.has(trimmed);
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizePiApiKeyEnvVar(value) {
  if (value == null || String(value).trim() === '') return null;
  const trimmed = String(value).trim();
  if (!ENV_SET.has(trimmed)) {
    throw new Error(`Invalid Pi API key env var: ${trimmed}`);
  }
  return trimmed;
}

/** @param {string | null | undefined} envVar */
export function piProviderIdForEnvVar(envVar) {
  const normalized = normalizePiApiKeyEnvVar(envVar ?? DEFAULT_PI_API_KEY_ENV_VAR);
  const entry = PI_API_KEY_ENV_VARS.find((e) => e.env === normalized);
  return entry?.provider_id ?? 'anthropic';
}
