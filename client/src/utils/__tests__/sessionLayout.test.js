import { describe, expect, it } from 'vitest';
import {
  SESSION_MAIN_MIN_WIDTH,
  clampSessionLayoutWidths,
  clampSessionsSidebarWidth,
  clampSidePanelWidth,
} from '../sessionLayout.js';

describe('clampSessionLayoutWidths', () => {
  it('shrinks columns on narrow desktop instead of ballooning to hardMax', () => {
    const viewportWidth = 900;
    const { sessionsSidebarWidth, sidePanelWidth } = clampSessionLayoutWidths(
      360,
      360,
      viewportWidth,
      { sessionsSidebarOpen: true, sidePanelOpen: true }
    );

    expect(sessionsSidebarWidth + sidePanelWidth + SESSION_MAIN_MIN_WIDTH).toBeLessThanOrEqual(
      viewportWidth
    );
    expect(sessionsSidebarWidth).toBeLessThan(360);
    expect(sidePanelWidth).toBeLessThanOrEqual(360);
  });

  it('does not widen a column when maxForMain is below column min', () => {
    const viewportWidth = 900;
    const sidebar = clampSessionsSidebarWidth(360, viewportWidth, {
      sessionsSidebarOpen: true,
      sidePanelOpen: true,
      sidePanelWidth: 360,
    });
    expect(sidebar).toBeLessThan(360);
    expect(sidebar).toBe(viewportWidth - 360 - SESSION_MAIN_MIN_WIDTH);
  });

  it('never grows side panel when space is tight', () => {
    const viewportWidth = 900;
    const panel = clampSidePanelWidth(360, viewportWidth, {
      sessionsSidebarOpen: true,
      sessionsSidebarWidth: 140,
      sidePanelOpen: true,
    });
    expect(panel).toBeLessThanOrEqual(360);
  });
});
