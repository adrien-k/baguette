import { Bot } from 'lucide-react';
import GithubIcon from './GithubIcon.jsx';
import { formatRepoLabel } from '../utils/repoDisplayName.js';

/** Org/repo (or Global) label for All Sessions lists. */
export default function CardRepoBadge({ show, isGlobal, repoFullName }) {
  if (!show) return null;
  if (isGlobal) {
    return (
      <span className="inline-flex items-center gap-1 shrink-0 text-xs text-zinc-500">
        <Bot className="w-3 h-3" />
        Global
      </span>
    );
  }
  if (!repoFullName) return null;
  return (
    <span className="inline-flex items-center gap-1 min-w-0 max-w-full text-xs text-zinc-500">
      <GithubIcon className="w-3 h-3 shrink-0" />
      <span className="truncate">{formatRepoLabel(repoFullName)}</span>
    </span>
  );
}
