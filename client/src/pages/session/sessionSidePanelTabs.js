export const SIDE_PANEL_TABS = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'reviewer', label: 'Reviewer' },
  { id: 'files', label: 'Files' },
  { id: 'commits', label: 'Commits' },
  { id: 'logs', label: 'Logs' },
];

export const SIDE_PANEL_TAB_IDS = new Set(SIDE_PANEL_TABS.map((t) => t.id));

export function resolveSidePanelTab(panelParam, activeView) {
  if (panelParam && SIDE_PANEL_TAB_IDS.has(panelParam)) return panelParam;
  if (activeView === 'diff') return 'files';
  if (activeView === 'review') return 'reviewer';
  return 'tasks';
}

export function defaultPanelForView(view) {
  if (view === 'diff') return 'files';
  if (view === 'review') return 'reviewer';
  return 'tasks';
}
