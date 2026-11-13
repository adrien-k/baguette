/** Minimum width for chat/diff/etc. between the sessions list and the side panel. */
export const SESSION_MAIN_MIN_WIDTH = 400;

export const SIDE_PANEL_WIDTH_DEFAULT = 360;
const SIDE_PANEL_WIDTH_MIN = 240;
const SIDE_PANEL_WIDTH_MAX = 800;

export const SESSIONS_SIDEBAR_WIDTH_DEFAULT = 360;
const SESSIONS_SIDEBAR_WIDTH_MIN = 240;
const SESSIONS_SIDEBAR_WIDTH_MAX = 600;

function hardMaxForViewport(viewportWidth, columnMax) {
  return Math.min(columnMax, Math.floor(viewportWidth * 0.65));
}

export function clampSessionsSidebarWidth(
  width,
  viewportWidth,
  { sessionsSidebarOpen, sidePanelOpen, sidePanelWidth }
) {
  const hardMax = hardMaxForViewport(viewportWidth, SESSIONS_SIDEBAR_WIDTH_MAX);
  const min = SESSIONS_SIDEBAR_WIDTH_MIN;
  if (!sessionsSidebarOpen || viewportWidth < 768) {
    return Math.round(Math.min(hardMax, Math.max(min, width)));
  }
  const reservedRight = sidePanelOpen && viewportWidth >= 768 ? Math.max(0, sidePanelWidth) : 0;
  const maxForMain = viewportWidth - reservedRight - SESSION_MAIN_MIN_WIDTH;
  if (maxForMain < min) {
    const tightMax = Math.max(0, maxForMain);
    return Math.round(Math.min(width, tightMax));
  }
  const max = Math.min(hardMax, maxForMain);
  return Math.round(Math.min(max, Math.max(min, width)));
}

export function clampSidePanelWidth(
  width,
  viewportWidth,
  { sessionsSidebarOpen, sessionsSidebarWidth, sidePanelOpen }
) {
  const hardMax = hardMaxForViewport(viewportWidth, SIDE_PANEL_WIDTH_MAX);
  const min = SIDE_PANEL_WIDTH_MIN;
  if (!sidePanelOpen || viewportWidth < 768) {
    return Math.round(Math.min(hardMax, Math.max(min, width)));
  }
  const reservedLeft =
    sessionsSidebarOpen && viewportWidth >= 768 ? Math.max(0, sessionsSidebarWidth) : 0;
  const maxForMain = viewportWidth - reservedLeft - SESSION_MAIN_MIN_WIDTH;
  if (maxForMain < min) {
    const tightMax = Math.max(0, maxForMain);
    return Math.round(Math.min(width, tightMax));
  }
  const max = Math.min(hardMax, maxForMain);
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** Clamp sidebar + side panel together so layout effects do not ping-pong. */
export function clampSessionLayoutWidths(
  sessionsSidebarWidth,
  sidePanelWidth,
  viewportWidth,
  { sessionsSidebarOpen, sidePanelOpen }
) {
  let sidebar = sessionsSidebarWidth;
  let panel = sidePanelWidth;
  const md = viewportWidth >= 768;

  for (let i = 0; i < 8; i += 1) {
    const nextSidebar =
      sessionsSidebarOpen && md
        ? clampSessionsSidebarWidth(sidebar, viewportWidth, {
            sessionsSidebarOpen,
            sidePanelOpen,
            sidePanelWidth: panel,
          })
        : sidebar;
    const nextPanel =
      sidePanelOpen && md
        ? clampSidePanelWidth(panel, viewportWidth, {
            sessionsSidebarOpen,
            sessionsSidebarWidth: nextSidebar,
            sidePanelOpen,
          })
        : panel;
    if (nextSidebar === sidebar && nextPanel === panel) break;
    sidebar = nextSidebar;
    panel = nextPanel;
  }

  return { sessionsSidebarWidth: sidebar, sidePanelWidth: panel };
}
