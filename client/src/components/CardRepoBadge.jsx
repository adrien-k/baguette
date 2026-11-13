import { Bot, FolderGit2 } from 'lucide-react';
import GithubIcon from './svg/GithubIcon.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';
import { repoAccessMode, repoAccessModeLabel } from '../utils/repoDisplayName.js';

function ModeIcon({ mode, className }) {
  if (mode === 'global') return <Bot className={className} />;
  if (mode === 'local') return <FolderGit2 className={className} />;
  return <GithubIcon className={className} />;
}

/** Org/repo (or Global) label for All Sessions lists. */
export default function CardRepoBadge({
  show,
  isGlobal,
  repoFullName,
  truncate = true,
  nowrap = false,
  className = '',
}) {
  const { uniqueLabel, repos } = useRepoContext();
  if (!show) return null;
  const repo = repos?.find((r) => r.full_name === repoFullName);
  const mode = isGlobal ? 'global' : repoAccessMode(repo ?? repoFullName);
  const label = isGlobal ? 'Global' : uniqueLabel(repoFullName);
  if (!label) return null;

  let outerClass = 'flex w-full max-w-full items-start';
  if (truncate) outerClass = 'inline-flex min-w-0 max-w-full items-center';
  else if (nowrap) outerClass = 'inline-flex shrink-0 items-center';

  let labelClass = 'min-w-0 break-words leading-snug';
  if (truncate) labelClass = 'min-w-0 truncate';
  else if (nowrap) labelClass = 'whitespace-nowrap';

  const iconClass = !nowrap && !truncate ? 'mt-0.5' : '';

  return (
    <span className={`gap-1 text-xs text-faint ${outerClass} ${className}`.trim()}>
      <ModeIcon mode={mode} className={`w-3 h-3 shrink-0 ${iconClass}`} />
      <span className={labelClass}>{label}</span>
      {mode === 'local' ? (
        <span className="text-[10px] bg-control-hover text-secondary px-1 py-0.5 rounded font-mono shrink-0">
          {repoAccessModeLabel(repo ?? repoFullName)}
        </span>
      ) : null}
    </span>
  );
}
