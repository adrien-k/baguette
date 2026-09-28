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

export default function SessionCommitsPanel({
  commits,
  commitsLoading,
  unavailable,
  selectedSha,
  onSelectCommit,
}) {
  if (unavailable) {
    return <p className="text-xs text-faint px-3 py-4">Not available for global sessions.</p>;
  }
  if (commitsLoading || commits === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-8">
        <div className="w-5 h-5 border-2 border-strong border-t-secondary rounded-full animate-spin" />
      </div>
    );
  }
  if (commits.length === 0) {
    return <p className="text-xs text-faint px-3 py-4">No commits on this branch yet.</p>;
  }
  return (
    <div className="flex-1 overflow-auto min-h-0 divide-y divide-line/50">
      {commits.map((c) => {
        const selected = selectedSha === c.sha;
        const interactive = typeof onSelectCommit === 'function';
        const rowClass = `w-full text-left px-3 py-2.5 transition-colors ${
          selected
            ? 'bg-brand/10 border-l-2 border-brand'
            : interactive
              ? 'hover:bg-control/80 border-l-2 border-transparent'
              : 'border-l-2 border-transparent'
        }`;
        const inner = (
          <>
            <div className="flex items-baseline gap-2 min-w-0">
              <code className="text-[10px] text-accent/90 font-mono shrink-0">{c.short_sha}</code>
              <span className="text-xs text-secondary truncate">{c.subject}</span>
            </div>
            <p className="text-[10px] text-faint mt-1 truncate">
              {c.author_name}
              {c.author_email ? (
                <>
                  {' '}
                  <span className="text-faint">&lt;{c.author_email}&gt;</span>
                </>
              ) : null}
              {' · '}
              {formatCommitDate(c.author_date)}
            </p>
          </>
        );
        if (!interactive) {
          return (
            <div key={c.sha} className={rowClass}>
              {inner}
            </div>
          );
        }
        return (
          <button
            key={c.sha}
            type="button"
            onClick={() => onSelectCommit(c.sha)}
            className={rowClass}
            title="View diff for this commit"
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
