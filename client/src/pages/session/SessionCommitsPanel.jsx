import { RefreshCw } from 'lucide-react';
import Tooltip from '../../components/Tooltip.jsx';

function formatCommitDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const SELECTED_COMMIT_BG = 'bg-brand/10';

function commitRowClass(selected) {
  return `px-3 py-2.5 ${selected ? SELECTED_COMMIT_BG : ''}`;
}

export default function SessionCommitsPanel({
  commits,
  commitsLoading,
  unavailable,
  selectedSha,
  allCommitsSelected,
  onSelectCommit,
  onRefresh,
}) {
  if (unavailable) {
    return <p className="text-xs text-faint px-3 py-4">Not available for global sessions.</p>;
  }

  const interactive = typeof onSelectCommit === 'function';
  const waitingForCommits = commits === undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 flex items-center justify-end border-b border-line/50 px-2 py-1.5">
        <button
          type="button"
          onClick={onRefresh}
          disabled={!onRefresh || commitsLoading}
          className="flex items-center gap-1.5 text-xs text-faint hover:text-secondary transition-colors disabled:opacity-40 p-1"
          title="Refresh commits"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${commitsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {waitingForCommits ? (
        <div className="flex flex-1 items-center justify-center px-3 py-8">
          <div className="w-5 h-5 border-2 border-strong border-t-secondary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-h-0 divide-y divide-line/50">
          {interactive && (
            <button
              type="button"
              onClick={() => onSelectCommit('all')}
              className={`w-full text-left text-xs cursor-pointer transition-colors ${commitRowClass(
                allCommitsSelected
              )} ${allCommitsSelected ? 'text-fg' : 'text-secondary hover:text-fg hover:bg-control'}`}
            >
              Show diff for all commits
            </button>
          )}
          {commits.length === 0 ? (
            <p className="text-xs text-faint px-3 py-4">No commits on this branch yet.</p>
          ) : (
            commits.map((c) => {
              const selected = selectedSha === c.sha;

              const authorLine = (
                <>
                  {c.author_name ? (
                    c.author_email ? (
                      <Tooltip content={c.author_email} placement="top">
                        <span className="truncate">{c.author_name}</span>
                      </Tooltip>
                    ) : (
                      <span className="truncate">{c.author_name}</span>
                    )
                  ) : null}
                  {c.author_date ? (
                    <>
                      {c.author_name ? ' · ' : null}
                      {formatCommitDate(c.author_date)}
                    </>
                  ) : null}
                </>
              );

              return (
                <div key={c.sha} className={commitRowClass(selected)}>
                  <div className="flex items-baseline gap-2 min-w-0">
                    <code className="text-[10px] text-accent/90 font-mono shrink-0">
                      {c.short_sha}
                    </code>
                    {interactive ? (
                      <button
                        type="button"
                        onClick={() => onSelectCommit(c.sha)}
                        className="text-xs text-secondary truncate text-left min-w-0 flex-1 cursor-pointer hover:text-fg"
                        title="View diff for this commit"
                      >
                        {c.subject}
                      </button>
                    ) : (
                      <span className="text-xs text-secondary truncate min-w-0 flex-1">
                        {c.subject}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-faint mt-1 truncate">{authorLine}</p>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
