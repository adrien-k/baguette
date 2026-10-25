import { Fragment } from 'react';
import { CheckCircle, PanelLeft, PanelRight } from 'lucide-react';
import Tooltip from '../../components/Tooltip.jsx';
import { LOOP_VIEWS } from './loopWorkspaceViews.js';
import {
  SESSION_VIEWS,
  GLOBAL_SESSION_VIEW_DISABLED_TOOLTIP,
  isGlobalSessionDisabledView,
} from './sessionViews.js';

export default function SessionViewTabs({
  isLoopsView,
  isSidebarOpen,
  onToggleSidebar,
  loopTabActive,
  isNewLoopRoute,
  onLoopTabChange,
  viewTabsScrollRef,
  activeViewTabRef,
  globalSessionViewDisabled,
  isNewSessionRoute,
  activeView,
  onViewTabClick,
  openIssuesTabCount,
  showIssuesTabCleanCheck,
  toggleSidePanel,
  showTasks,
  reviewer,
}) {
  return (
    <div className="flex shrink-0 items-center border-b border-line bg-nav px-3 sm:px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="hidden md:flex items-center justify-center mr-1 shrink-0 text-faint hover:text-secondary transition-colors"
        title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      >
        <PanelLeft className="w-4 h-4" />
      </button>
      {isLoopsView ? (
        <div className="relative min-w-0 flex-1">
          <div className="flex overflow-x-auto gap-1 scrollbar-none pr-4">
            {LOOP_VIEWS.map(({ id, label, Icon }) => {
              const tabDisabled = isNewLoopRoute && id === 'runs';
              return (
                <button
                  key={id}
                  type="button"
                  disabled={tabDisabled}
                  onClick={() => onLoopTabChange(id)}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors -mb-px disabled:cursor-not-allowed disabled:opacity-40 ${
                    loopTabActive === id
                      ? 'border-brand text-accent'
                      : 'border-transparent text-faint hover:text-heading disabled:hover:text-faint'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-nav via-nav/80 to-transparent"
            aria-hidden
          />
        </div>
      ) : (
        <>
          <div className="relative min-w-0 flex-1">
            <div ref={viewTabsScrollRef} className="flex overflow-x-auto gap-1 scrollbar-none pr-4">
              {SESSION_VIEWS.map(({ id, label, Icon }) => {
                const tabDisabledForGlobal =
                  globalSessionViewDisabled && isGlobalSessionDisabledView(id);
                const tabDisabled = isNewSessionRoute || tabDisabledForGlobal;
                const tabButton = (
                  <button
                    ref={activeView === id && !isNewSessionRoute ? activeViewTabRef : null}
                    type="button"
                    disabled={tabDisabled}
                    onClick={() => onViewTabClick(id)}
                    className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors -mb-px disabled:cursor-not-allowed disabled:opacity-40 ${
                      activeView === id && !isNewSessionRoute
                        ? 'border-brand text-accent'
                        : 'border-transparent text-faint hover:text-heading disabled:hover:text-faint'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                    {id === 'review' && openIssuesTabCount > 0 && (
                      <span className="min-w-4 h-4 px-1 rounded-full bg-brand text-on-brand text-[10px] font-bold leading-4">
                        {openIssuesTabCount}
                      </span>
                    )}
                    {id === 'review' && showIssuesTabCleanCheck && (
                      <CheckCircle
                        className="w-3.5 h-3.5 shrink-0 text-success"
                        aria-label="No open issues"
                      />
                    )}
                  </button>
                );
                if (!tabDisabledForGlobal) {
                  return <Fragment key={id}>{tabButton}</Fragment>;
                }
                return (
                  <Tooltip
                    key={id}
                    content={GLOBAL_SESSION_VIEW_DISABLED_TOOLTIP}
                    wrap
                    placement="bottom"
                  >
                    {tabButton}
                  </Tooltip>
                );
              })}
            </div>
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-nav via-nav/80 to-transparent"
              aria-hidden
            />
          </div>
          <button
            type="button"
            disabled={isNewSessionRoute}
            onClick={toggleSidePanel}
            className={`flex items-center justify-center shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              !isNewSessionRoute &&
              reviewer &&
              (reviewer.status === 'running' || reviewer.status === 'approval') &&
              !showTasks
                ? 'text-accent motion-safe:animate-pulse'
                : 'text-faint hover:text-heading'
            }`}
            title={showTasks ? 'Hide side panel' : 'Show side panel'}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
