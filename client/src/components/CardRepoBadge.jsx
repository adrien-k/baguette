import { Bot } from 'lucide-react';
import GithubIcon from './svg/GithubIcon.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';

/** Org/repo (or Global) label for All Sessions lists. */
export default function CardRepoBadge({
  show,
  isGlobal,
  repoFullName,
  truncate = true,
  nowrap = false,
  className = '',
}) {
  const { uniqueLabel } = useRepoContext();
  if (!show) return null;
  const Icon = isGlobal ? Bot : GithubIcon;
  const label = isGlobal ? 'Global' : uniqueLabel(repoFullName);
  if (!label) return null;

  const outerClass = truncate
    ? 'inline-flex min-w-0 max-w-full items-center'
    : nowrap
      ? 'inline-flex shrink-0 items-center'
      : 'flex w-full max-w-full items-start';

  const labelClass = truncate
    ? 'min-w-0 truncate'
    : nowrap
      ? 'whitespace-nowrap'
      : 'min-w-0 break-words leading-snug';

  return (
    <span className={`gap-1 text-xs text-faint ${outerClass} ${className}`.trim()}>
      <Icon className={`w-3 h-3 shrink-0 ${nowrap ? '' : truncate ? '' : 'mt-0.5'}`} />
      <span className={labelClass}>{label}</span>
    </span>
  );
}
