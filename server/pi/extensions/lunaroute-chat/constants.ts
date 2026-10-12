export const LUNAROUTE_PROVIDER = 'lunaroute';

/** Keep in sync with `shared` gateway filter and `server/lib/lunaroute-gateway-models.js`. */
export const NON_CHAT_CAPABILITIES = [
  'image_generation',
  'embeddings',
  'rerank',
  'systemone',
  'transcription',
] as const;
