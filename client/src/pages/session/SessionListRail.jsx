import { Link } from 'react-router-dom';
import { MessageSquare, Plus, Repeat } from 'lucide-react';
import MiniLoopEntry from '../../components/MiniLoopEntry.jsx';
import MiniSessionEntry from '../../components/MiniSessionEntry.jsx';
import SessionListFilters from '../../components/SessionListFilters.jsx';
export default function SessionListRail({
  sessionsSidebarElRef,
  mobilePreferList,
  sessionsSidebarResizing,
  showSidebar,
  isSidebarOpen,
  sessionsSidebarWidth,
  isSidebarOpenForResize,
  onSessionsSidebarResizeStart,
  homeUrl,
  loopsHomeUrl,
  isLoopsView,
  highlightNewCreate,
  onNewLoop,
  onNewSession,
  loopsLoaded,
  loops,
  routeLoopId,
  isNewLoopRoute,
  mobilePreferListForHighlight,
  reloadLoops,
  onDeleteLoop,
  sidebarSessions,
  routeSessionId,
  isNewSessionRoute,
  hideSessionListRepo,
  suppressOpenSessionUnread,
  onSessionArchived,
  hasMoreSessions,
  sessionsLength,
  onLoadMoreSessions,
}) {
  return (
    <div
      ref={sessionsSidebarElRef}
      className={`${mobilePreferList ? 'flex w-full flex-1 md:w-auto md:flex-none' : 'hidden'} md:block relative shrink-0 min-h-0 overflow-hidden border-r border-line bg-nav ${
        sessionsSidebarResizing ? '' : 'transition-[width] duration-300 ease-in-out'
      } ${showSidebar === false ? 'md:w-0 md:border-r-0' : ''}`}
      style={
        isSidebarOpen && !mobilePreferList
          ? {
              width: 'var(--sessions-sidebar-w)',
              '--sessions-sidebar-w': `${sessionsSidebarWidth}px`,
            }
          : undefined
      }
    >
      {isSidebarOpenForResize && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sessions list"
          onPointerDown={onSessionsSidebarResizeStart}
          className="absolute right-0 top-0 bottom-0 z-10 w-1.5 translate-x-1/2 cursor-col-resize touch-none hover:bg-brand/50 active:bg-brand/70"
        />
      )}
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        <div
          className="flex shrink-0 gap-1.5 border-b border-line p-2"
          role="tablist"
          aria-label="Workspace"
        >
          {[
            { to: homeUrl, label: 'Sessions', active: !isLoopsView, icon: MessageSquare },
            { to: loopsHomeUrl, label: 'Loops', active: isLoopsView, icon: Repeat },
          ].map(({ to, label, active, icon: TabIcon }) => (
            <Link
              key={label}
              to={to}
              role="tab"
              aria-selected={active}
              className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'bg-control-hover text-fg'
                  : 'text-fg-muted hover:bg-control/50 hover:text-heading'
              }`}
            >
              {TabIcon && <TabIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />}
              {label}
            </Link>
          ))}
        </div>
        <div className="shrink-0 border-b border-line p-2">
          {isLoopsView ? (
            <button
              type="button"
              onClick={onNewLoop}
              className={`flex min-h-9 w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                highlightNewCreate
                  ? 'bg-control-hover text-fg'
                  : 'text-fg-muted hover:bg-control/50 hover:text-heading'
              }`}
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>New loop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onNewSession}
              className={`flex min-h-9 w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                highlightNewCreate
                  ? 'bg-control-hover text-fg'
                  : 'text-fg-muted hover:bg-control/50 hover:text-heading'
              }`}
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>New session</span>
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto min-h-0">
          {isLoopsView ? (
            <>
              {loopsLoaded && !loops.length && (
                <p className="px-3 py-4 text-xs text-faint text-center">No loops configured.</p>
              )}
              {!loopsLoaded && loops.length === 0 && (
                <p className="px-3 py-4 text-xs text-faint text-center">Loading loops…</p>
              )}
              {loops.map((loop) => (
                <MiniLoopEntry
                  key={loop.id}
                  loop={loop}
                  currentLoopId={
                    mobilePreferListForHighlight || isNewLoopRoute ? null : routeLoopId
                  }
                  onToggle={reloadLoops}
                  onDelete={onDeleteLoop}
                />
              ))}
            </>
          ) : (
            <>
              {sidebarSessions.map((s) => (
                <MiniSessionEntry
                  key={s.id}
                  session={s}
                  currentId={
                    mobilePreferListForHighlight || isNewSessionRoute ? null : routeSessionId
                  }
                  hideRepoBadge={hideSessionListRepo}
                  suppressUnreadWhenOpen={
                    String(s.id) === String(routeSessionId) && suppressOpenSessionUnread
                  }
                  onArchive={onSessionArchived}
                />
              ))}
              {hasMoreSessions && sessionsLength > 0 && (
                <button
                  onClick={onLoadMoreSessions}
                  className="w-full px-3 py-2 text-xs text-faint hover:text-fg-muted transition-colors text-left"
                >
                  Load more
                </button>
              )}
            </>
          )}
        </div>
        {!isLoopsView && <SessionListFilters />}
      </div>
    </div>
  );
}
