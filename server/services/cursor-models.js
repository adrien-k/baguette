import { Cursor } from '@cursor/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import * as cache from '../lib/cache.js';

const MODELS_CACHE_KEY = 'cursor-models-keyed';
const MODELS_CACHE_TTL = Infinity;

const DEFAULT_MODELS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../data/cursor-models-default.json'
);

function loadDefaultModels() {
  try {
    return JSON.parse(readFileSync(DEFAULT_MODELS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function mapSdkModels(sdkModels) {
  return sdkModels
    .filter((m) => m.id !== '')
    .map((m) => ({
      id: m.id,
      display_name: m.displayName ?? m.id,
      description: m.description ?? null,
      variants: m.variants?.length
        ? m.variants.map((v) => ({
            display_name: v.displayName,
            description: v.description ?? null,
            is_default: v.isDefault ?? false,
            params: v.params,
          }))
        : null,
    }));
}

export async function listCursorModels(apiKey) {
  try {
    return await cache.fetch(MODELS_CACHE_KEY, MODELS_CACHE_TTL, async () => {
      const sdkModels = await Cursor.models.list({ apiKey });
      return mapSdkModels(sdkModels);
    });
  } catch {
    return loadDefaultModels();
  }
}

export async function refreshCursorModels(apiKey) {
  await cache.clear(MODELS_CACHE_KEY);
  // Throws on failure — callers must handle the error
  const sdkModels = await Cursor.models.list({ apiKey });
  return mapSdkModels(sdkModels);
}
