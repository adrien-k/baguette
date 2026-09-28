import { RefreshCw } from 'lucide-react';
import { splitRepoPath, diffFileDisplayPath } from '../../utils/paths.js';

export default function SessionFilesPanel({
  diffFiles,
  filesLoading,
  onSelectFile,
  onRefresh,
  unavailable,
}) {
  if (unavailable) {
    return <p className="text-xs text-faint px-3 py-4">Not available for global sessions.</p>;
  }

  const waitingForFiles = diffFiles === undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 flex items-center justify-end border-b border-line/50 px-2 py-1.5">
        <button
          type="button"
          onClick={onRefresh}
          disabled={!onRefresh || filesLoading}
          className="flex items-center gap-1.5 text-xs text-faint hover:text-secondary transition-colors disabled:opacity-40 p-1"
          title="Refresh files"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${filesLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {waitingForFiles ? (
        <div className="flex flex-1 items-center justify-center px-3 py-8">
          <div className="w-5 h-5 border-2 border-strong border-t-secondary rounded-full animate-spin" />
        </div>
      ) : diffFiles.length === 0 ? (
        <p className="text-xs text-faint px-3 py-4">No files changed</p>
      ) : (
        <div className="flex-1 overflow-auto min-h-0">
          {diffFiles.map((file) => {
            const displayPath = diffFileDisplayPath(file);
            const { basename, dirname } = splitRepoPath(displayPath);
            return (
              <button
                key={displayPath}
                type="button"
                onClick={() => onSelectFile?.(file)}
                className="w-full flex items-start justify-between gap-2 px-3 py-2 text-left hover:bg-control transition-colors border-b border-line/50"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-xs text-secondary truncate block">
                    {basename}
                  </span>
                  {dirname ? (
                    <span className="font-mono text-[10px] text-faint truncate block mt-0.5">
                      {dirname}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1 pt-0.5">
                  <span className="text-xs text-success">+{file.addedCount}</span>
                  <span className="text-xs text-danger">-{file.removedCount}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
