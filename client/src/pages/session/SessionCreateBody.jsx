import { Loader2 } from 'lucide-react';
import BuilderForm from '../../components/BuilderForm.jsx';

export default function SessionCreateBody({
  creatingSession,
  createSessionError,
  onDismissCreateError,
  newSessionFormKey,
  builderAllowRepoChoice,
  builderRepoFullName,
  onSubmit,
  loading,
  isGlobal,
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-page">
      {creatingSession && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-page/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-accent" />
            <p className="text-sm font-medium text-fg">Starting your agent session…</p>
            <p className="text-xs text-fg-muted">This usually only takes a few seconds.</p>
          </div>
        </div>
      )}
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8">
        {createSessionError && (
          <div className="mb-4 bg-soft-danger/30 border border-danger/50 rounded-md px-3 sm:px-4 py-3 text-sm text-danger">
            <div className="flex items-start justify-between gap-2">
              <p className="break-all">{createSessionError}</p>
              <button
                type="button"
                onClick={onDismissCreateError}
                className="text-danger hover:text-danger shrink-0 text-lg leading-none"
              >
                &times;
              </button>
            </div>
          </div>
        )}
        <BuilderForm
          key={`session-new-${newSessionFormKey}-${builderAllowRepoChoice ? 'all' : (builderRepoFullName ?? 'global')}`}
          onSubmit={onSubmit}
          loading={loading}
          repoFullName={builderRepoFullName}
          isGlobal={isGlobal}
          allowRepoChoice={builderAllowRepoChoice}
        />
      </div>
    </div>
  );
}
