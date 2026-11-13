import { describe, expect, it } from 'vitest';
import { mapCatalogEntry } from '../catalog.js';

describe('mapCatalogEntry', () => {
  it('maps a chat model with window metadata', () => {
    const result = mapCatalogEntry({
      id: 'glm-5.3-flash',
      display_name: 'GLM Flash',
      context_window: 128000,
      max_output_tokens: 8192,
    });
    expect(result).toEqual({
      ok: true,
      model: expect.objectContaining({
        id: 'glm-5.3-flash',
        name: 'GLM Flash',
        contextWindow: 128000,
        maxTokens: 8192,
      }),
    });
  });

  it('rejects non-chat capabilities', () => {
    const result = mapCatalogEntry({
      id: 'emb-1',
      context_window: 8192,
      max_output_tokens: 512,
      capabilities: { embeddings: true },
    });
    expect(result).toMatchObject({ ok: false, reason: 'non_chat_capability' });
  });
});
