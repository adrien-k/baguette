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
function groupByNamespacedLabel(items, getLabel) {
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

/** Tooltip for configured task buttons — description when set, otherwise the command. */
export function configCommandTooltip(cmd) {
  const desc = (cmd.description || '').trim();
  if (desc) return desc;
  if (cmd.run) return cmd.run;
  if (cmd.type === 'docker' && cmd.image) return cmd.image;
  return '';
}

export function taskConfirmStateFromCommand(cmd, taskKey) {
  return {
    taskKey,
    description: (cmd.description || '').trim() || null,
    runPreview: cmd.run || (cmd.type === 'docker' ? cmd.image : null),
  };
}
