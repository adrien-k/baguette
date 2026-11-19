import { repoDisplayName, repoAccessModeLabel } from '../utils/repoDisplayName.js';

/**
 * Read-only list of repositories linked to the current user (Settings / onboarding).
 */
export default function LinkedRepositoriesList({ repos, emptyMessage = 'No repositories added' }) {
  if (repos.length === 0) {
    return <p className="text-faint text-sm text-center py-4">{emptyMessage}</p>;
  }

  return (
    <div className="divide-y divide-line">
      {repos.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-sm text-fg font-medium">{repoDisplayName(r.full_name)}</code>
              <span className="text-xs bg-control-hover text-secondary px-1.5 py-0.5 rounded font-mono">
                {repoAccessModeLabel(r)}
              </span>
            </div>
            {r.full_name.startsWith('/') && (
              <div className="text-xs text-faint mt-0.5 font-mono truncate">{r.full_name}</div>
            )}
            <div className="text-xs text-faint mt-0.5">
              {r.session_count} session(s) · {r.exists_on_fs ? 'On disk' : 'Not on disk'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
