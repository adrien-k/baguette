export const SIDE_PANEL_TABS = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'reviewer', label: 'Reviewer' },
  { id: 'files', label: 'Files' },
  { id: 'commits', label: 'Commits' },
  { id: 'logs', label: 'Logs' },
];

export const SIDE_PANEL_TAB_IDS = new Set(SIDE_PANEL_TABS.map((t) => t.id));

export function resolveSidePanelTab(panelParam, fallback = 'tasks') {
  if (panelParam && SIDE_PANEL_TAB_IDS.has(panelParam)) return panelParam;
  if (fallback && SIDE_PANEL_TAB_IDS.has(fallback)) return fallback;
  return 'tasks';
}
