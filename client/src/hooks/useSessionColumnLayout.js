import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { usePersistentState } from './usePersistentState.js';
import {
  useColumnResizePointer,
  widenFromLeftEdge,
  widenFromRightEdge,
} from './useColumnResizePointer.js';
import {
  SIDE_PANEL_WIDTH_DEFAULT,
  SESSIONS_SIDEBAR_WIDTH_DEFAULT,
  clampSessionsSidebarWidth,
  clampSidePanelWidth,
  clampSessionLayoutWidths,
} from '../utils/sessionLayout.js';
import { useMediaQuery } from './useMediaQuery.js';

/**
 * Left sessions rail + right side panel widths, resize handles, and md breakpoint.
 */
export function useSessionColumnLayout({ isNewSessionRoute, isLoopsView, showTasks }) {
  const isMdUp = useMediaQuery('(min-width: 768px)');
  const [showSidebar, setShowSidebar] = useState(null);
  const isSidebarOpen = showSidebar !== false;
  const isSidePanelOpen = !isNewSessionRoute && !isLoopsView && showTasks;
  const sessionsSidebarElRef = useRef(null);
  const sidePanelElRef = useRef(null);
  const [sessionsSidebarResizing, setSessionsSidebarResizing] = useState(false);
  const sessionsSidebarPersist = usePersistentState('sessions-sidebar');
  const [sessionsSidebarWidth, setSessionsSidebarWidth] = sessionsSidebarPersist.useState(
    'width',
    SESSIONS_SIDEBAR_WIDTH_DEFAULT
  );
  const sidePanelPersist = usePersistentState('session-side-panel');
  const [sidePanelWidth, setSidePanelWidth] = sidePanelPersist.useState(
    'width',
    SIDE_PANEL_WIDTH_DEFAULT
  );

  useLayoutEffect(() => {
    try {
      const store = JSON.parse(localStorage.getItem('session-side-panel') || '{}');
      if (store.width != null) return;
      const legacy = store.reviewWidth ?? store.tasksWidth;
      if (typeof legacy === 'number') setSidePanelWidth(legacy);
    } catch {
      /* ignore */
    }
  }, [setSidePanelWidth]);

  const clampSessionsSidebar = useCallback(
    (width, viewportWidth) =>
      clampSessionsSidebarWidth(width, viewportWidth, {
        sessionsSidebarOpen: isSidebarOpen,
        sidePanelOpen: isSidePanelOpen,
        sidePanelWidth,
      }),
    [isSidebarOpen, isSidePanelOpen, sidePanelWidth]
  );

  const clampSidePanel = useCallback(
    (width, viewportWidth) =>
      clampSidePanelWidth(width, viewportWidth, {
        sessionsSidebarOpen: isSidebarOpen,
        sessionsSidebarWidth,
        sidePanelOpen: isSidePanelOpen,
      }),
    [isSidebarOpen, sessionsSidebarWidth, isSidePanelOpen]
  );

  const applySessionsSidebarLiveWidth = useCallback((px) => {
    sessionsSidebarElRef.current?.style.setProperty('--sessions-sidebar-w', `${px}px`);
  }, []);
  const applySidePanelLiveWidth = useCallback((px) => {
    sidePanelElRef.current?.style.setProperty('--side-panel-w', `${px}px`);
  }, []);

  const handleSessionsSidebarResizeStart = useColumnResizePointer(
    widenFromRightEdge,
    clampSessionsSidebar,
    {
      onActiveChange: setSessionsSidebarResizing,
      setLiveWidth: applySessionsSidebarLiveWidth,
    }
  );
  const handleSidePanelResizeStart = useColumnResizePointer(widenFromLeftEdge, clampSidePanel, {
    setLiveWidth: applySidePanelLiveWidth,
  });

  useEffect(() => {
    if (!isMdUp) setShowSidebar(false);
  }, [isMdUp]);

  useLayoutEffect(() => {
    if (!isMdUp) return;
    if (!isSidebarOpen && !isSidePanelOpen) return;
    const { sessionsSidebarWidth: nextSidebar, sidePanelWidth: nextPanel } =
      clampSessionLayoutWidths(sessionsSidebarWidth, sidePanelWidth, window.innerWidth, {
        sessionsSidebarOpen: isSidebarOpen,
        sidePanelOpen: isSidePanelOpen,
      });
    if (nextSidebar !== sessionsSidebarWidth) setSessionsSidebarWidth(nextSidebar);
    if (nextPanel !== sidePanelWidth) setSidePanelWidth(nextPanel);
  }, [
    isMdUp,
    isSidebarOpen,
    isSidePanelOpen,
    sidePanelWidth,
    sessionsSidebarWidth,
    setSessionsSidebarWidth,
    setSidePanelWidth,
  ]);

  useEffect(() => {
    if (!isMdUp) return;
    const onResize = () => {
      const { sessionsSidebarWidth: nextSidebar, sidePanelWidth: nextPanel } =
        clampSessionLayoutWidths(sessionsSidebarWidth, sidePanelWidth, window.innerWidth, {
          sessionsSidebarOpen: isSidebarOpen,
          sidePanelOpen: isSidePanelOpen,
        });
      if (nextSidebar !== sessionsSidebarWidth) setSessionsSidebarWidth(nextSidebar);
      if (nextPanel !== sidePanelWidth) setSidePanelWidth(nextPanel);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [
    isMdUp,
    isSidebarOpen,
    isSidePanelOpen,
    sessionsSidebarWidth,
    sidePanelWidth,
    setSessionsSidebarWidth,
    setSidePanelWidth,
  ]);

  return {
    isMdUp,
    isSidebarOpen,
    isSidePanelOpen,
    showSidebar,
    setShowSidebar,
    sessionsSidebarElRef,
    sidePanelElRef,
    sessionsSidebarResizing,
    sessionsSidebarWidth,
    setSessionsSidebarWidth,
    sidePanelWidth,
    setSidePanelWidth,
    handleSessionsSidebarResizeStart,
    handleSidePanelResizeStart,
  };
}
