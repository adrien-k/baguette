import { Bot } from 'lucide-react';
import GithubIcon from './svg/GithubIcon.jsx';
import { formatRepoLabel } from '../utils/repoDisplayName.js';

/** Org/repo (or Global) label for All Sessions lists. */
export default function CardRepoBadge({ show, isGlobal, repoFullName }) {
  if (!show) return null;
  const Icon = isGlobal ? Bot : GithubIcon;
  const label = isGlobal ? 'Global' : formatRepoLabel(repoFullName);
  if (!label) return null;

  return (
    <span className="inline-flex items-center gap-1 min-w-0 max-w-full text-xs text-zinc-500">
      <Icon className="w-3 h-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
