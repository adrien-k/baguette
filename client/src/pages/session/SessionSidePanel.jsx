import { X } from 'lucide-react';
import SessionFilesPanel from './SessionFilesPanel.jsx';
import SessionCommitsPanel from './SessionCommitsPanel.jsx';
import AgentsPanel from './AgentsPanel.jsx';
import LogsView from './LogsView.jsx';
import TaskPanel from '../../components/TaskPanel.jsx';
import { SIDE_PANEL_TABS } from './sessionSidePanelTabs.js';

function sidePanelTabClass(active) {
  return `shrink-0 px-2.5 py-2 text-[11px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
    active ? 'border-brand text-accent' : 'border-transparent text-faint hover:text-heading'
  }`;
}

export default function SessionSidePanel({
  sidePanelTab,
  onSidePanelTabChange,
  onClose,
  session: _session,
  isGlobal,
  readonly,
  sidePanelOpen: _sidePanelOpen,
  diffFiles,
  changedFilesLoading,
  onRefreshChangedFiles,
  onSelectDiffFile,
  selectedDiffFilePath,
  branchCommits,
  branchCommitsLoading,
  onRefreshBranchCommits,
  selectedDiffCommit,
  diffViewActive,
  onSelectCommit,
  tasks,
  configCommands,
  onStartTask,
  onRunCommand,
  onKill,
  onDelete,
  onRetry,
  onViewLogs,
  onViewBaguetteConfig,
  showBaguetteConfigLink,
  rawMessages,
  loadMore,
  loadingMore,
  hasMore,
  chatOpen,
  agentLabelById,
  sessionId,
  selectedAgentId,
  onSelectAgent,
  onReviewerCleared,
}) {
  const filesUnavailable = isGlobal;
  const sidePanelTabs = SIDE_PANEL_TABS;

  return (
    <>
      <div className="shrink-0 border-b border-line flex items-center gap-1 min-w-0">
        <div className="flex flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {sidePanelTabs.map((tab) => (
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
          className="xl:hidden text-faint hover:text-fg-muted transition-colors p-1 shrink-0 mr-1"
          title="Hide side panel"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {sidePanelTab === 'files' && (
          <SessionFilesPanel
            diffFiles={diffFiles}
            filesLoading={changedFilesLoading}
            selectedFilePath={selectedDiffFilePath}
            onSelectFile={onSelectDiffFile}
            onRefresh={onRefreshChangedFiles}
            unavailable={filesUnavailable}
          />
        )}
        {sidePanelTab === 'commits' && (
          <SessionCommitsPanel
            commits={branchCommits}
            commitsLoading={branchCommitsLoading}
            unavailable={filesUnavailable}
            selectedSha={diffViewActive && selectedDiffCommit !== 'all' ? selectedDiffCommit : null}
            allCommitsSelected={diffViewActive && selectedDiffCommit === 'all'}
            onSelectCommit={onSelectCommit}
            onRefresh={onRefreshBranchCommits}
          />
        )}
        {sidePanelTab === 'agents' && (
          <AgentsPanel
            sessionId={sessionId}
            selectedAgentId={selectedAgentId}
            onSelectAgent={onSelectAgent}
            onReviewerCleared={onReviewerCleared}
            readonly={readonly}
          />
        )}
        {sidePanelTab === 'logs' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <LogsView
              rawMessages={rawMessages}
              loadMore={loadMore}
              loadingMore={loadingMore}
              hasMore={hasMore}
              chatOpen={chatOpen}
              resetKey={sessionId}
              agentLabelById={agentLabelById}
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
            onViewBaguetteConfig={onViewBaguetteConfig}
            showBaguetteConfigLink={showBaguetteConfigLink}
            readonly={readonly}
          />
        )}
      </div>
    </>
  );
}
