import { X } from 'lucide-react';
import SessionFilesPanel from './SessionFilesPanel.jsx';
import SessionCommitsPanel from './SessionCommitsPanel.jsx';
import ReviewAgentPanel from './ReviewAgentPanel.jsx';
import LogsView from './LogsView.jsx';
import TaskPanel from '../../components/TaskPanel.jsx';
import { SIDE_PANEL_TABS } from './sessionSidePanelTabs.js';

function sidePanelTabClass(active) {
  return `shrink-0 px-2.5 py-2 text-[11px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
    active
      ? 'border-amber-500 text-amber-400'
      : 'border-transparent text-zinc-500 hover:text-zinc-300'
  }`;
}

export default function SessionSidePanel({
  sidePanelTab,
  onSidePanelTabChange,
  onClose,
  session,
  isGlobal,
  readonly,
  sidePanelOpen,
  diffFiles,
  onSelectDiffFile,
  branchCommits,
  branchCommitsLoading,
  selectedDiffCommit,
  onSelectCommit,
  tasks,
  configCommands,
  onStartTask,
  onRunCommand,
  onKill,
  onDelete,
  onRetry,
  onViewLogs,
  rawMessages,
  loadMore,
  loadingMore,
  hasMore,
  sessionId,
}) {
  const filesUnavailable = isGlobal;

  return (
    <>
      <div className="shrink-0 border-b border-zinc-800 flex items-center gap-1 min-w-0">
        <div className="flex flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {SIDE_PANEL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSidePanelTabChange(tab.id)}
              className={sidePanelTabClass(sidePanelTab === tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="xl:hidden text-zinc-600 hover:text-zinc-400 transition-colors p-1 shrink-0 mr-1"
          title="Hide side panel"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {sidePanelTab === 'files' && (
          <SessionFilesPanel
            diffFiles={diffFiles}
            onSelectFile={onSelectDiffFile}
            unavailable={filesUnavailable}
          />
        )}
        {sidePanelTab === 'commits' && (
          <SessionCommitsPanel
            commits={branchCommits}
            commitsLoading={branchCommitsLoading}
            unavailable={filesUnavailable}
            selectedSha={selectedDiffCommit !== 'all' ? selectedDiffCommit : null}
            onSelectCommit={onSelectCommit}
          />
        )}
        {sidePanelTab === 'reviewer' && (
          <ReviewAgentPanel session={session} readonly={readonly} sidePanelOpen={sidePanelOpen} />
        )}
        {sidePanelTab === 'logs' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <LogsView
              rawMessages={rawMessages}
              loadMore={loadMore}
              loadingMore={loadingMore}
              hasMore={hasMore}
              resetKey={sessionId}
            />
          </div>
        )}
        {sidePanelTab === 'tasks' && (
          <TaskPanel
            tasks={tasks}
            configCommands={configCommands}
            onStartTask={onStartTask}
            onRunCommand={onRunCommand}
            onKill={onKill}
            onDelete={onDelete}
            onRetry={onRetry}
            onViewLogs={onViewLogs}
            readonly={readonly}
          />
        )}
      </div>
    </>
  );
}
