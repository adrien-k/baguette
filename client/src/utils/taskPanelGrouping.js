/** First `:` splits namespaced labels (e.g. `docker:postgres:16`, `baguette:init`). */
export function parseTaskNamespace(name) {
  const i = name.indexOf(':');
  if (i <= 0) return { namespace: null, localName: name };
  return { namespace: name.slice(0, i), localName: name.slice(i + 1) };
}

function compareByLabel(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/**
 * Sort items by label and bucket namespaced labels (`prefix:rest`) for subgroup headers.
 * @param {object[]} items
 * @param {(item: object) => string} getLabel
 * @returns {{ ungrouped: object[], namespaces: { namespace: string, items: object[] }[] }}
 */
export function groupByNamespacedLabel(items, getLabel) {
  const sorted = [...items].sort((a, b) => compareByLabel(getLabel(a), getLabel(b)));
  const ungrouped = [];
  const byNamespace = new Map();

  for (const item of sorted) {
    const { namespace } = parseTaskNamespace(getLabel(item));
    if (!namespace) {
      ungrouped.push(item);
      continue;
    }
    if (!byNamespace.has(namespace)) byNamespace.set(namespace, []);
    byNamespace.get(namespace).push(item);
  }

  const namespaces = [...byNamespace.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, nsItems]) => ({ namespace, items: nsItems }));

  return { ungrouped, namespaces };
}

export function groupConfigCommandsForPanel(commands) {
  return groupByNamespacedLabel(commands, (cmd) => (cmd.label || '').trim());
}

export function configCommandButtonLabel(cmd, inNamespace) {
  const name = (cmd.label || '').trim();
  if (!inNamespace) return name;
  const { localName } = parseTaskNamespace(name);
  return localName || name;
}
