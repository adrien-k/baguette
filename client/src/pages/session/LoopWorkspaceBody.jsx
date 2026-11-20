import { Loader2 } from 'lucide-react';
import BuilderForm from '../../components/BuilderForm.jsx';
import LoopOverviewPanel from './LoopOverviewPanel.jsx';
import { useFilterRoutes } from '../../hooks/useFilterRoutes.js';
import { NEUTRAL_BUTTON_CLASS } from '../../utils/buttonStyles.js';

export default function LoopWorkspaceBody({
  workspaceOpen,
  loopLoading,
  loopLoadFailed,
  onRetryLoadLoop,
  isNewLoopRoute,
  activeTab,
  loop,
  editingLoop,
  saving,
  builderIsGlobal,
  builderRepoFullName,
  builderAllowRepoChoice,
  onCreateLoop,
  onUpdateLoop,
  onDeleteLoop,
  runSessions,
  runsLoading,
  runsLoaded,
  onRunLoop,
  runningLoop,
}) {
  const { showRepoDetails } = useFilterRoutes();

  if (!workspaceOpen) return null;

  if (loopLoading) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center bg-page">
        <Loader2 className="w-8 h-8 animate-spin text-accent" aria-label="Loading loop" />
      </div>
    );
  }

  if (loopLoadFailed) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 bg-page p-8 text-center">
        <p className="text-sm text-fg-muted">This loop could not be loaded.</p>
        <button type="button" onClick={onRetryLoadLoop} className={NEUTRAL_BUTTON_CLASS}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-page">
      {(isNewLoopRoute || activeTab === 'edit') && (
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8">
          <BuilderForm
            key={`loop-form-${editingLoop?.id ?? 'new'}-${builderRepoFullName ?? 'scope'}`}
            mode="loop"
            editingLoop={editingLoop}
            onCreateLoop={onCreateLoop}
            onUpdateLoop={onUpdateLoop}
            onDeleteLoop={editingLoop ? onDeleteLoop : undefined}
            loading={saving}
            repoFullName={builderRepoFullName}
            isGlobal={builderIsGlobal}
            allowRepoChoice={builderAllowRepoChoice}
          />
        </div>
      )}
      {!isNewLoopRoute && activeTab === 'overview' && loop && (
        <LoopOverviewPanel
          loop={loop}
          showRepoDetails={showRepoDetails}
          runSessions={runSessions}
          runsLoading={runsLoading}
          runsLoaded={runsLoaded}
          suppressRepoBadge={!showRepoDetails}
          onRunLoop={onRunLoop}
          runningLoop={runningLoop}
        />
      )}
    </div>
  );
}
