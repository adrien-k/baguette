export function taskDisplayName(task) {
  return (task.label || task.command || '').trim();
}

/** First `:` splits namespace tasks (e.g. `docker:postgres:16`, `baguette:init`). */
export function parseTaskNamespace(name) {
  const i = name.indexOf(':');
  if (i <= 0) return { namespace: null, localName: name };
  return { namespace: name.slice(0, i), localName: name.slice(i + 1) };
}

export function compareTasksByName(a, b) {
  return taskDisplayName(a).localeCompare(taskDisplayName(b), undefined, { sensitivity: 'base' });
}

/**
 * Sort tasks by display name and bucket namespaced tasks (`prefix:rest`) for subgroup headers.
 * @returns {{ ungrouped: object[], namespaces: { namespace: string, tasks: object[] }[] }}
 */
export function groupTasksForPanel(tasks) {
  const sorted = [...tasks].sort(compareTasksByName);
  const ungrouped = [];
  const byNamespace = new Map();

  for (const task of sorted) {
    const { namespace } = parseTaskNamespace(taskDisplayName(task));
    if (!namespace) {
      ungrouped.push(task);
      continue;
    }
    if (!byNamespace.has(namespace)) byNamespace.set(namespace, []);
    byNamespace.get(namespace).push(task);
  }

  const namespaces = [...byNamespace.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, nsTasks]) => ({ namespace, tasks: nsTasks }));

  return { ungrouped, namespaces };
}

export function taskRowTitle(task, inNamespace) {
  const name = taskDisplayName(task);
  if (!inNamespace) return name;
  const { localName } = parseTaskNamespace(name);
  return localName || name;
}
