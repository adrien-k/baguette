export const SIDE_PANEL_TABS = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'reviewer', label: 'Reviewer' },
  { id: 'files', label: 'Files' },
  { id: 'commits', label: 'Commits' },
  { id: 'logs', label: 'Logs' },
];

export const SIDE_PANEL_TAB_IDS = new Set(SIDE_PANEL_TABS.map((t) => t.id));

export function resolveSidePanelTab(panelParam) {
  if (panelParam && SIDE_PANEL_TAB_IDS.has(panelParam)) return panelParam;
  return 'tasks';
}
