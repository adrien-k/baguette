import { buildVariantsFromParamAxes } from './model-variant-axes.js';

const PI_THINKING_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const DEFAULT_PI_PARAMS = [{ id: 'reasoning', value: 'medium' }];

function sortThinkingLevels(levels) {
  const unique = [...new Set(levels)];
  return unique.sort((a, b) => {
    const ai = PI_THINKING_ORDER.indexOf(a);
    const bi = PI_THINKING_ORDER.indexOf(b);
    if (ai < 0 && bi < 0) return a.localeCompare(b);
    if (ai < 0) return 1;
    if (bi < 0) return -1;
    return ai - bi;
  });
}

/**
 * @param {{ thinkingLevelMap?: Record<string, string | null> } | null | undefined} catalogModel
 */
export function piThinkingLevelsFromCatalogModel(catalogModel) {
  const map = catalogModel?.thinkingLevelMap;
  if (map && typeof map === 'object') {
    const levels = Object.entries(map)
      .filter(([, v]) => v !== null)
      .map(([k]) => k);
    if (levels.length) return sortThinkingLevels(levels);
  }
  return ['off', 'low', 'medium', 'high'];
}

/**
 * @param {{ id: string, display_name?: string, thinkingLevelMap?: Record<string, string | null> }} model
 */
export function attachPiModelVariants(model) {
  const levels = piThinkingLevelsFromCatalogModel(model);
  if (!levels.length) return model;
  const axes = [{ id: 'reasoning', values: levels }];
  const variants = buildVariantsFromParamAxes(axes, { defaultParams: DEFAULT_PI_PARAMS });
  return { ...model, variants };
}
