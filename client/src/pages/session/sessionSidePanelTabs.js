export const SIDE_PANEL_TABS = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'agents', label: 'Agents' },
  { id: 'files', label: 'Files' },
  { id: 'commits', label: 'Commits' },
  { id: 'logs', label: 'Logs' },
];

export const SIDE_PANEL_TAB_IDS = new Set(SIDE_PANEL_TABS.map((t) => t.id));

export function resolveSidePanelTab(panelParam, fallback = 'tasks') {
  const normalized = panelParam === 'reviewer' ? 'agents' : panelParam;
  if (normalized && SIDE_PANEL_TAB_IDS.has(normalized)) return normalized;
  if (fallback && SIDE_PANEL_TAB_IDS.has(fallback)) return fallback;
  return 'tasks';
}
