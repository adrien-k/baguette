import { Bot } from 'lucide-react';
import GithubIcon from './svg/GithubIcon.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';

/** Org/repo (or Global) label for All Sessions lists. */
export default function CardRepoBadge({ show, isGlobal, repoFullName }) {
  const { uniqueLabel } = useRepoContext();
  if (!show) return null;
  const Icon = isGlobal ? Bot : GithubIcon;
  const label = isGlobal ? 'Global' : uniqueLabel(repoFullName);
  if (!label) return null;

  return (
    <span className="inline-flex items-center gap-1 min-w-0 max-w-full text-xs text-faint">
      <Icon className="w-3 h-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
