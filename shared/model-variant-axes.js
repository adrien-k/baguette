import { formatParamDisplayValue } from './model-variants.js';

/**
 * Cartesian product of param axes into Cursor-style model variants.
 *
 * @param {Array<{ id: string, values: string[] }>} axes
 * @param {{ defaultParams?: Array<{ id: string, value: string }> }} [options]
 */
export function buildVariantsFromParamAxes(axes, { defaultParams = [] } = {}) {
  if (!axes?.length) {
    return [{ display_name: 'Default', description: null, is_default: true, params: [] }];
  }

  let combos = [{ params: [] }];
  for (const axis of axes) {
    const values = axis.values?.length ? axis.values : [];
    if (!values.length) continue;
    const next = [];
    for (const combo of combos) {
      for (const value of values) {
        next.push({
          params: [...combo.params, { id: axis.id, value }],
        });
      }
    }
    combos = next;
  }

  const defaultKey = JSON.stringify(
    (defaultParams ?? []).map((p) => ({ id: p.id, value: p.value }))
  );

  return combos.map((combo, index) => {
    const key = JSON.stringify(combo.params.map((p) => ({ id: p.id, value: p.value })));
    const isDefault = defaultKey ? key === defaultKey : index === 0;
    const label = combo.params
      .map((p) => formatParamDisplayValue(p.id, p.value))
      .filter(Boolean)
      .join(' · ');
    return {
      display_name: label || 'Default',
      description: null,
      is_default: isDefault,
      params: combo.params,
    };
  });
}
