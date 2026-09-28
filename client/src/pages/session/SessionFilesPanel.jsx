import { splitRepoPath } from '../../utils/paths.js';

export default function SessionFilesPanel({ diffFiles, onSelectFile, unavailable }) {
  if (unavailable) {
    return <p className="text-xs text-faint px-3 py-4">Not available for global sessions.</p>;
  }
  if (diffFiles.length === 0) {
    return <p className="text-xs text-faint px-3 py-4">No files changed</p>;
  }
  return (
    <div className="flex-1 overflow-auto min-h-0">
      {diffFiles.map((file, i) => {
        const displayPath = file.newPath !== '/dev/null' ? file.newPath : file.oldPath;
        const { basename, dirname } = splitRepoPath(displayPath);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelectFile?.(i)}
            className="w-full flex items-start justify-between gap-2 px-3 py-2 text-left hover:bg-control transition-colors border-b border-line/50"
          >
            <div className="min-w-0 flex-1">
              <span className="font-mono text-xs text-secondary truncate block">{basename}</span>
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
  );
}
